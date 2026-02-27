-- TrstLyr Protocol — Supabase Schema
-- Paste this into the Supabase SQL editor and run it once.

-- ── x402 free tier tracking ───────────────────────────────────────────────────
-- Tracks which subjects have used their one free attestation.

CREATE TABLE IF NOT EXISTS attestation_free_tier (
  subject    TEXT PRIMARY KEY,
  used_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE attestation_free_tier ENABLE ROW LEVEL SECURITY;

-- Service role key bypasses RLS — no policy needed for backend use.
-- If using anon key, add: CREATE POLICY "allow all" ON attestation_free_tier FOR ALL USING (true);

-- ── x402 nonce replay protection ──────────────────────────────────────────────
-- Prevents EIP-3009 payment replays.

CREATE TABLE IF NOT EXISTS attestation_nonces (
  nonce      TEXT PRIMARY KEY,
  used_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE attestation_nonces ENABLE ROW LEVEL SECURITY;

-- ── Identity graph ────────────────────────────────────────────────────────────
-- Verified cross-namespace identity links (twitter ↔ github ↔ erc8004 etc.)

CREATE TABLE IF NOT EXISTS identity_links (
  id              TEXT PRIMARY KEY,
  from_ns         TEXT        NOT NULL,
  from_id         TEXT        NOT NULL,
  to_ns           TEXT        NOT NULL,
  to_id           TEXT        NOT NULL,
  method          TEXT        NOT NULL,
  confidence      FLOAT       NOT NULL,
  evidence        JSONB,
  verified_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  attestation_uid TEXT
);

ALTER TABLE identity_links ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_identity_links_from ON identity_links (from_ns, from_id);
CREATE INDEX IF NOT EXISTS idx_identity_links_to   ON identity_links (to_ns,   to_id);



