-- TrstLyr Protocol — trust score history
-- Records every evaluated trust score for trend analysis and auditing.

CREATE TABLE IF NOT EXISTS trust_score_history (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  subject        TEXT        NOT NULL,
  trust_score    FLOAT       NOT NULL,
  confidence     FLOAT       NOT NULL,
  risk_level     TEXT        NOT NULL,
  recommendation TEXT        NOT NULL,
  signal_count   INT         NOT NULL DEFAULT 0,
  query_id       TEXT,
  evaluated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE trust_score_history ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_trust_history_subject_time
  ON trust_score_history (subject, evaluated_at DESC);
