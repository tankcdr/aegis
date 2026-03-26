// ── Response types matching the TrstLyr API ──

export type RiskLevel = 'minimal' | 'low' | 'medium' | 'high' | 'critical';
export type Recommendation = 'allow' | 'install' | 'review' | 'caution' | 'deny';
export type EntityType = 'agent' | 'repo' | 'skill' | 'developer' | 'unknown';

export interface ScoreInterpretation {
  summary: string;
  signal_count: number;
  signal_diversity: number;
  sybil_resistance: 'low' | 'medium' | 'high';
}

export interface Signal {
  provider: string;
  signal_type: string;
  score: number;
  confidence: number;
  evidence: Record<string, unknown>;
  timestamp: string;
  ttl?: number;
}

export interface FraudSignal {
  type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  agents?: string[];
  evidence?: Record<string, unknown>;
  detected_at: string;
}

export interface TrustScore {
  subject: string;
  trust_score: number;
  confidence: number;
  uncertainty: number;
  valid_until: string;
  score_interpretation: ScoreInterpretation;
  risk_level: RiskLevel;
  recommendation: Recommendation;
  entity_type: EntityType;
  recommendation_label: string;
  signals: Signal[];
  fraud_signals: FraudSignal[];
  unresolved: Array<{ provider: string; reason: string }>;
  evaluated_at: string;
  metadata?: {
    attestation_uid?: string;
    query_id: string;
  };
}

export interface Attestation {
  subject: string;
  trust_score: number;
  confidence: number;
  risk_level: string;
  recommendation: string;
  attestation_uid: string | null;
  attestation_url: string | null;
  on_chain: boolean;
  signals_used: number;
  query_id: string | null;
  computed_at: string;
  payment: {
    amount_usdc?: string;
    token?: string;
    network?: string;
    free_tier?: boolean;
  };
}

export interface BehavioralOpts {
  subject: string;
  interactionType?: 'delegation' | 'trade' | 'task' | 'data_access' | 'payment' | 'other';
  outcome: 'success' | 'partial' | 'failed';
  rating: number;
  evidenceURI?: string;
  interactionAt?: number;
  value_usd?: number;
}

export interface BehavioralResult {
  attestationUID: string | null;
  txHash: string | null;
  subject: string;
  outcome: string;
  baseUrl: string | null;
  eas_error?: string;
  eas_writer_configured?: false;
}

export interface BehavioralAttestation {
  id: string;
  attester: string;
  interaction_type: string;
  outcome: string;
  rating: number;
  evidence_uri: string | null;
  interaction_at: string;
  value_usdc: number;
  disputed: boolean;
  eas_uid: string | null;
  created_at: string;
}

export interface BehavioralSummary {
  total_interactions: number;
  success_rate: number;
  avg_rating: number;
  dispute_rate: number;
}

export interface BehavioralHistory {
  subject: string;
  behavioral_summary: BehavioralSummary;
  behavioral_score: number;
  attestations: BehavioralAttestation[];
}

// ── Client configuration ──

export interface ClientConfig {
  apiKey?: string;
  baseUrl?: string;
  timeout?: number;
  /** If true, throw on API errors instead of returning defaults. Default: false (fail open). */
  strictMode?: boolean;
}

// ── Errors ──

export class TrstLyrError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'TrstLyrError';
  }
}

export class TrustGateError extends TrstLyrError {
  constructor(
    public readonly subject: string,
    public readonly trustScore: number,
    public readonly threshold: number,
  ) {
    super(
      `Trust gate blocked ${subject}: score ${trustScore} < threshold ${threshold}`,
      403,
      'TRUST_GATE_BLOCKED',
    );
    this.name = 'TrustGateError';
  }
}

export class PaymentRequiredError extends TrstLyrError {
  constructor(message?: string) {
    super(message ?? 'Payment required (x402)', 402, 'PAYMENT_REQUIRED');
    this.name = 'PaymentRequiredError';
  }
}
