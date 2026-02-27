// Database — Supabase persistence layer
//
// Uses Supabase JS client (service role key — bypasses RLS for backend use).
// Falls back to in-memory if SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set.
//
// Tables (create via Supabase SQL editor — see docs/supabase-schema.sql):
//   attestation_free_tier  — x402 free usage tracking
//   attestation_nonces     — x402 replay protection
//   identity_links         — verified agent identity graph

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// ─── Client ───────────────────────────────────────────────────────────────────

let supabase: SupabaseClient | null = null;

export function isDbConnected(): boolean {
  return supabase !== null;
}

export async function initDb(): Promise<void> {
  const url = process.env['SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];

  if (!url || !key) {
    console.log('[db] SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not set — using in-memory stores (data lost on restart)');
    return;
  }

  supabase = createClient(url, key, {
    auth: { persistSession: false },
  });

  // Smoke test
  const { error } = await supabase.from('identity_links').select('id').limit(1);
  if (error && error.code !== 'PGRST116') {
    console.error('[db] Supabase connection error:', error.message);
    supabase = null;
    return;
  }

  console.log('[db] Supabase connected');
}

// ─── In-memory fallbacks ──────────────────────────────────────────────────────

const _freeTier = new Set<string>();
const _nonces   = new Set<string>();

// ─── x402 free tier ───────────────────────────────────────────────────────────

export async function hasUsedFree(subject: string): Promise<boolean> {
  const key = subject.toLowerCase();
  if (!supabase) return _freeTier.has(key);

  const { data } = await supabase
    .from('attestation_free_tier')
    .select('subject')
    .eq('subject', key)
    .maybeSingle();

  return data !== null;
}

export async function markFreeUsed(subject: string): Promise<void> {
  const key = subject.toLowerCase();
  if (!supabase) { _freeTier.add(key); return; }

  await supabase
    .from('attestation_free_tier')
    .upsert({ subject: key }, { onConflict: 'subject' });
}

// ─── x402 nonce replay ────────────────────────────────────────────────────────

export async function isNonceUsed(nonce: string): Promise<boolean> {
  const key = nonce.toLowerCase();
  if (!supabase) return _nonces.has(key);

  const { data } = await supabase
    .from('attestation_nonces')
    .select('nonce')
    .eq('nonce', key)
    .maybeSingle();

  return data !== null;
}

export async function markNonceUsed(nonce: string): Promise<void> {
  const key = nonce.toLowerCase();
  if (!supabase) { _nonces.add(key); return; }

  await supabase
    .from('attestation_nonces')
    .upsert({ nonce: key }, { onConflict: 'nonce' });
}

// ─── Identity links ───────────────────────────────────────────────────────────

export interface PersistedLink {
  id:              string;
  from_ns:         string;
  from_id:         string;
  to_ns:           string;
  to_id:           string;
  method:          string;
  confidence:      number;
  evidence:        Record<string, unknown>;
  verified_at:     string;
  attestation_uid?: string;
}

export async function saveIdentityLink(link: PersistedLink): Promise<void> {
  if (!supabase) return;

  await supabase
    .from('identity_links')
    .upsert(link, { onConflict: 'id' });
}

export async function loadIdentityLinks(): Promise<PersistedLink[]> {
  if (!supabase) return [];

  const { data, error } = await supabase
    .from('identity_links')
    .select('*');

  if (error) {
    console.error('[db] Failed to load identity links:', error.message);
    return [];
  }

  return (data ?? []) as PersistedLink[];
}

// ─── Pending challenges ───────────────────────────────────────────────────────

export interface PersistedChallenge {
  id:               string;
  subject_ns:       string;
  subject_id:       string;
  link_to_ns?:      string | null;
  link_to_id?:      string | null;
  method:           string;
  challenge_string: string;
  instructions:     string;
  status:           string;
  created_at:       string;
  expires_at:       string;
}

export async function saveChallenge(c: PersistedChallenge): Promise<void> {
  if (!supabase) return;
  await supabase.from('pending_challenges').upsert(c, { onConflict: 'id' });
}

export async function deletePersistedChallenge(id: string): Promise<void> {
  if (!supabase) return;
  await supabase.from('pending_challenges').delete().eq('id', id);
}

export async function loadPendingChallenges(): Promise<PersistedChallenge[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('pending_challenges')
    .select('*')
    .eq('status', 'pending')
    .gt('expires_at', new Date().toISOString());
  if (error) {
    console.error('[db] Failed to load pending challenges:', error.message);
    return [];
  }
  return (data ?? []) as PersistedChallenge[];
}

// ─── Trust score history ──────────────────────────────────────────────────────

export interface ScoreHistoryEntry {
  id?:            string;
  subject:        string;
  trust_score:    number;
  confidence:     number;
  risk_level:     string;
  recommendation: string;
  signal_count:   number;
  query_id?:      string | null;
  evaluated_at:   string;
}

export async function saveScoreHistory(entry: ScoreHistoryEntry): Promise<void> {
  if (!supabase) return;
  await supabase.from('trust_score_history').insert(entry);
}

export async function loadScoreHistory(
  subject: string,
  limit = 30,
): Promise<ScoreHistoryEntry[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('trust_score_history')
    .select('*')
    .eq('subject', subject)
    .order('evaluated_at', { ascending: false })
    .limit(limit);
  if (error) {
    console.error('[db] Failed to load score history:', error.message);
    return [];
  }
  return (data ?? []) as ScoreHistoryEntry[];
}

// ─── Stats ────────────────────────────────────────────────────────────────────

export async function dbStats(): Promise<{
  freeUsedCount:  number;
  usedNonceCount: number;
  backend:        string;
}> {
  if (!supabase) {
    return { freeUsedCount: _freeTier.size, usedNonceCount: _nonces.size, backend: 'memory' };
  }

  const [free, nonces] = await Promise.all([
    supabase.from('attestation_free_tier').select('*', { count: 'exact', head: true }),
    supabase.from('attestation_nonces').select('*', { count: 'exact', head: true }),
  ]);

  return {
    freeUsedCount:  free.count  ?? 0,
    usedNonceCount: nonces.count ?? 0,
    backend: 'supabase',
  };
}
