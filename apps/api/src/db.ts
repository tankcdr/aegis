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

// ─── Agent Index ──────────────────────────────────────────────────────────────
//
// Supabase SQL to create the table:
//
//   CREATE TABLE IF NOT EXISTS agent_index (
//     id               TEXT PRIMARY KEY,
//     name             TEXT NOT NULL,
//     description      TEXT,
//     entity_type      TEXT DEFAULT 'agent',
//     protocols        TEXT[] DEFAULT '{}',
//     capabilities     TEXT[] DEFAULT '{}',
//     claimed          BOOLEAN DEFAULT false,
//     provider_sources TEXT[] DEFAULT '{}',
//     last_indexed_at  TIMESTAMPTZ DEFAULT NOW(),
//     metadata         JSONB DEFAULT '{}'
//   );
//   CREATE INDEX IF NOT EXISTS agent_index_protocols    ON agent_index USING GIN (protocols);
//   CREATE INDEX IF NOT EXISTS agent_index_capabilities ON agent_index USING GIN (capabilities);

export interface AgentIndexRow {
  id:               string;
  name:             string;
  description?:     string;
  entity_type:      'agent' | 'skill' | 'developer';
  protocols:        string[];
  capabilities:     string[];
  claimed:          boolean;
  provider_sources: string[];
  last_indexed_at:  string;
  metadata:         Record<string, unknown>;
}

interface AgentIndexFilters {
  provider?:    string[];
  capability?:  string[];
  protocol?:    string[];
  claimed?:     boolean;
  q?:           string;
  limit?:       number;
  offset?:      number;
}

export async function listAgentIndex(filters: AgentIndexFilters = {}): Promise<AgentIndexRow[]> {
  if (!supabase) return [];

  let query = supabase.from('agent_index').select('*');

  if (filters.claimed !== undefined) {
    query = query.eq('claimed', filters.claimed);
  }
  if (filters.protocol && filters.protocol.length > 0) {
    query = query.overlaps('protocols', filters.protocol);
  }
  if (filters.capability && filters.capability.length > 0) {
    query = query.overlaps('capabilities', filters.capability);
  }
  if (filters.provider && filters.provider.length > 0) {
    query = query.overlaps('provider_sources', filters.provider);
  }

  const { data, error } = await query
    .order('last_indexed_at', { ascending: false })
    .limit(filters.limit ?? 100);

  if (error) {
    console.error('[db] listAgentIndex error:', error.message);
    return [];
  }
  return (data ?? []) as AgentIndexRow[];
}

export async function countAgentIndex(filters: AgentIndexFilters = {}): Promise<number> {
  if (!supabase) return 0;

  let query = supabase
    .from('agent_index')
    .select('*', { count: 'exact', head: true });

  if (filters.claimed !== undefined) {
    query = query.eq('claimed', filters.claimed);
  }
  if (filters.protocol && filters.protocol.length > 0) {
    query = query.overlaps('protocols', filters.protocol);
  }
  if (filters.capability && filters.capability.length > 0) {
    query = query.overlaps('capabilities', filters.capability);
  }
  if (filters.provider && filters.provider.length > 0) {
    query = query.overlaps('provider_sources', filters.provider);
  }

  const { count, error } = await query;
  if (error) {
    console.error('[db] countAgentIndex error:', error.message);
    return 0;
  }
  return count ?? 0;
}

export async function upsertAgentIndex(agent: AgentIndexRow): Promise<void> {
  if (!supabase) return;
  await supabase
    .from('agent_index')
    .upsert({ ...agent, last_indexed_at: new Date().toISOString() }, { onConflict: 'id' });
}

// ─── Behavioral attestations ─────────────────────────────────────────────────

export interface BehavioralAttestationRow {
  id?:              string;
  subject:          string;
  attester:         string;
  interaction_type: string;
  outcome:          number;
  rating:           number;
  evidence_uri?:    string | null;
  interaction_at:   string;
  value_usdc:       number;
  disputed:         boolean;
  eas_uid?:         string | null;
  tx_hash?:         string | null;
  created_at?:      string;
}

export async function saveBehavioralAttestation(row: BehavioralAttestationRow): Promise<string | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('behavioral_attestations')
    .insert(row)
    .select('id')
    .single();
  if (error) {
    console.error('[db] saveBehavioralAttestation error:', error.message);
    return null;
  }
  return data?.id ?? null;
}

export async function loadBehavioralAttestations(subject: string): Promise<BehavioralAttestationRow[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('behavioral_attestations')
    .select('*')
    .eq('subject', subject)
    .order('created_at', { ascending: false });
  if (error) {
    console.error('[db] loadBehavioralAttestations error:', error.message);
    return [];
  }
  return (data ?? []) as BehavioralAttestationRow[];
}

export async function countRecentAttestations(
  attester: string,
  subject: string,
  windowDays = 30,
): Promise<number> {
  if (!supabase) return 0;
  const since = new Date(Date.now() - windowDays * 86_400_000).toISOString();
  const { count, error } = await supabase
    .from('behavioral_attestations')
    .select('*', { count: 'exact', head: true })
    .eq('attester', attester)
    .eq('subject', subject)
    .gte('created_at', since);
  if (error) {
    console.error('[db] countRecentAttestations error:', error.message);
    return 0;
  }
  return count ?? 0;
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
