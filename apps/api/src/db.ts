// Database — Postgres persistence layer
//
// Covers the three things that MUST survive restarts:
//   1. x402 free tier tracking  (someone paid — that's real money)
//   2. x402 nonce replay store  (security)
//   3. Identity graph links      (agents earned their verification)
//
// Gracefully falls back to in-memory if DATABASE_URL is not set.
// All public functions have identical signatures regardless of backend.

import pg from 'pg';
const { Pool } = pg;

// ─── Connection ───────────────────────────────────────────────────────────────

let pool: InstanceType<typeof Pool> | null = null;

export function isDbConnected(): boolean {
  return pool !== null;
}

export async function initDb(): Promise<void> {
  const url = process.env['DATABASE_URL'];
  if (!url) {
    console.log('[db] DATABASE_URL not set — using in-memory stores (data lost on restart)');
    return;
  }

  pool = new Pool({
    connectionString: url,
    ssl: url.includes('localhost') ? false : { rejectUnauthorized: false },
    max: 10,
    idleTimeoutMillis: 30_000,
  });

  // Smoke test
  const client = await pool.connect();
  try {
    await client.query('SELECT 1');
    console.log('[db] Postgres connected');
  } finally {
    client.release();
  }

  await migrate();
}

// ─── Migrations ───────────────────────────────────────────────────────────────

async function migrate(): Promise<void> {
  if (!pool) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS attestation_free_tier (
      subject    TEXT PRIMARY KEY,
      used_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS attestation_nonces (
      nonce      TEXT PRIMARY KEY,
      used_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS identity_links (
      id              TEXT PRIMARY KEY,
      from_ns         TEXT NOT NULL,
      from_id         TEXT NOT NULL,
      to_ns           TEXT NOT NULL,
      to_id           TEXT NOT NULL,
      method          TEXT NOT NULL,
      confidence      FLOAT NOT NULL,
      evidence        JSONB,
      verified_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      attestation_uid TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_identity_links_from ON identity_links (from_ns, from_id);
    CREATE INDEX IF NOT EXISTS idx_identity_links_to   ON identity_links (to_ns,   to_id);
  `);

  console.log('[db] Tables ready');
}

// ─── x402 free tier ───────────────────────────────────────────────────────────

// In-memory fallback
const _freeTier = new Set<string>();

export async function hasUsedFree(subject: string): Promise<boolean> {
  const key = subject.toLowerCase();
  if (!pool) return _freeTier.has(key);

  const res = await pool.query(
    'SELECT 1 FROM attestation_free_tier WHERE subject = $1',
    [key],
  );
  return res.rowCount! > 0;
}

export async function markFreeUsed(subject: string): Promise<void> {
  const key = subject.toLowerCase();
  if (!pool) { _freeTier.add(key); return; }

  await pool.query(
    'INSERT INTO attestation_free_tier (subject) VALUES ($1) ON CONFLICT DO NOTHING',
    [key],
  );
}

// ─── x402 nonce replay ────────────────────────────────────────────────────────

const _nonces = new Set<string>();

export async function isNonceUsed(nonce: string): Promise<boolean> {
  const key = nonce.toLowerCase();
  if (!pool) return _nonces.has(key);

  const res = await pool.query(
    'SELECT 1 FROM attestation_nonces WHERE nonce = $1',
    [key],
  );
  return res.rowCount! > 0;
}

export async function markNonceUsed(nonce: string): Promise<void> {
  const key = nonce.toLowerCase();
  if (!pool) { _nonces.add(key); return; }

  await pool.query(
    'INSERT INTO attestation_nonces (nonce) VALUES ($1) ON CONFLICT DO NOTHING',
    [key],
  );
}

// ─── Identity links ───────────────────────────────────────────────────────────

export interface PersistedLink {
  id:             string;
  from_ns:        string;
  from_id:        string;
  to_ns:          string;
  to_id:          string;
  method:         string;
  confidence:     number;
  evidence:       Record<string, unknown>;
  verified_at:    string;
  attestation_uid?: string;
}

export async function saveIdentityLink(link: PersistedLink): Promise<void> {
  if (!pool) return; // in-memory graph is already updated by identityGraph.addLink()

  await pool.query(
    `INSERT INTO identity_links
       (id, from_ns, from_id, to_ns, to_id, method, confidence, evidence, verified_at, attestation_uid)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (id) DO UPDATE SET
       confidence     = EXCLUDED.confidence,
       evidence       = EXCLUDED.evidence,
       attestation_uid = EXCLUDED.attestation_uid`,
    [
      link.id, link.from_ns, link.from_id, link.to_ns, link.to_id,
      link.method, link.confidence, JSON.stringify(link.evidence),
      link.verified_at, link.attestation_uid ?? null,
    ],
  );
}

export async function loadIdentityLinks(): Promise<PersistedLink[]> {
  if (!pool) return [];

  const res = await pool.query<PersistedLink>('SELECT * FROM identity_links');
  return res.rows;
}

// ─── Stats ────────────────────────────────────────────────────────────────────

export async function dbStats(): Promise<{ freeUsedCount: number; usedNonceCount: number; backend: string }> {
  if (!pool) {
    return { freeUsedCount: _freeTier.size, usedNonceCount: _nonces.size, backend: 'memory' };
  }

  const [free, nonces] = await Promise.all([
    pool.query('SELECT COUNT(*) FROM attestation_free_tier'),
    pool.query('SELECT COUNT(*) FROM attestation_nonces'),
  ]);

  return {
    freeUsedCount:  parseInt(free.rows[0].count, 10),
    usedNonceCount: parseInt(nonces.rows[0].count, 10),
    backend: 'postgres',
  };
}
