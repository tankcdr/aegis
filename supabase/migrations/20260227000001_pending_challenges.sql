-- TrstLyr Protocol — pending identity challenges
-- Persists issued challenges so a Railway restart doesn't invalidate in-flight verifications.

CREATE TABLE IF NOT EXISTS pending_challenges (
  id               TEXT        PRIMARY KEY,
  subject_ns       TEXT        NOT NULL,
  subject_id       TEXT        NOT NULL,
  link_to_ns       TEXT,
  link_to_id       TEXT,
  method           TEXT        NOT NULL,
  challenge_string TEXT        NOT NULL,
  instructions     TEXT        NOT NULL,
  status           TEXT        NOT NULL DEFAULT 'pending',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at       TIMESTAMPTZ NOT NULL
);

ALTER TABLE pending_challenges ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_pending_challenges_expires ON pending_challenges (expires_at);
