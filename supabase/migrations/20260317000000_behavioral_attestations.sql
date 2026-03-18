-- Behavioral attestations — post-interaction trust signals
-- Spec: BEHAVIORAL_ATTESTATIONS.md

CREATE TABLE IF NOT EXISTS behavioral_attestations (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject          TEXT NOT NULL,
  attester         TEXT NOT NULL,
  interaction_type TEXT NOT NULL,
  outcome          SMALLINT NOT NULL CHECK (outcome BETWEEN 0 AND 2),
  rating           SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  evidence_uri     TEXT,
  interaction_at   TIMESTAMPTZ NOT NULL,
  value_usdc       BIGINT DEFAULT 0,
  disputed         BOOLEAN DEFAULT false,
  eas_uid          TEXT,
  tx_hash          TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- Query by subject (most common access pattern)
CREATE INDEX IF NOT EXISTS idx_behavioral_subject ON behavioral_attestations (subject, created_at DESC);

-- Query by attester (rate limiting, history)
CREATE INDEX IF NOT EXISTS idx_behavioral_attester ON behavioral_attestations (attester, created_at DESC);

-- Enforce no self-attestation
ALTER TABLE behavioral_attestations ADD CONSTRAINT no_self_attestation CHECK (subject != attester);

-- Rate limit: max 10 attestations per attester per subject per 30 days
-- (enforced at application layer, index supports the check)
CREATE INDEX IF NOT EXISTS idx_behavioral_rate_limit ON behavioral_attestations (attester, subject, created_at);
