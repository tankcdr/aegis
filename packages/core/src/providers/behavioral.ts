// Behavioral Provider — post-interaction attestation signals
//
// Queries Supabase for behavioral attestations about a subject and computes
// a Subjective Logic opinion based on outcomes, ratings, and dispute rate.
//
// Weight table (uncertainty):
//   0 attestations  → u=1.0 (vacuous — no impact)
//   1-5             → u=0.6 (low confidence)
//   6-20            → u=0.3 (medium confidence)
//   20+             → u=0.1 (high confidence)
//
// Subject formats: any namespace (behavioral attestations are cross-namespace)

import type {
  EvaluateRequest,
  HealthStatus,
  Provider,
  ProviderMetadata,
  Signal,
  Subject,
} from '../types/index.js';

/** Row shape returned by the Supabase query function */
export interface BehavioralRow {
  id?: string;
  subject: string;
  attester: string;
  interaction_type: string;
  outcome: number;
  rating: number;
  evidence_uri?: string | null;
  interaction_at: string;
  value_usdc: number;
  disputed: boolean;
  eas_uid?: string | null;
  tx_hash?: string | null;
  created_at?: string;
}

/** Function type for fetching behavioral attestations from the DB */
export type BehavioralFetcher = (subject: string) => Promise<BehavioralRow[]>;

export class BehavioralProvider implements Provider {
  private readonly fetchAttestations: BehavioralFetcher;

  constructor(fetcher: BehavioralFetcher) {
    this.fetchAttestations = fetcher;
  }

  metadata(): ProviderMetadata {
    return {
      name: 'behavioral',
      version: '1.0.0',
      description: 'Post-interaction behavioral attestations from counterparties',
      supported_subjects: ['agent'],
      supported_namespaces: ['erc8004', 'github', 'twitter', 'moltbook', 'clawhub', 'self', 'did', 'ens', 'wallet'],
      signal_types: [
        {
          type: 'behavioral_reputation',
          description: 'Aggregated behavioral attestation signals: success rate, rating, disputes',
        },
      ],
      rate_limit: { requests_per_minute: 300, burst: 50 },
    };
  }

  supported(subject: Subject): boolean {
    // Behavioral attestations can exist for any namespace
    return true;
  }

  async evaluate(request: EvaluateRequest): Promise<Signal[]> {
    const { subject } = request;
    const subjectKey = `${subject.namespace}:${subject.id}`;
    const timestamp = new Date().toISOString();

    try {
      const rows = await this.fetchAttestations(subjectKey);

      if (rows.length === 0) {
        // Vacuous opinion — no behavioral data, full uncertainty
        return [{
          provider: 'behavioral',
          signal_type: 'behavioral_reputation',
          score: 0.5,      // neutral (base rate)
          confidence: 0.0,  // no information → uncertainty=1.0, confidence=0.0
          evidence: { total_interactions: 0 },
          timestamp,
          ttl: 300,
        }];
      }

      // Compute behavioral metrics
      const total = rows.length;
      const successes = rows.filter(r => r.outcome === 2).length;
      const failures = rows.filter(r => r.outcome === 0).length;
      const disputed = rows.filter(r => r.disputed).length;
      const successRate = successes / total;
      const disputeRate = disputed / total;
      const avgRating = rows.reduce((sum, r) => sum + r.rating, 0) / total;

      // Score: weighted combination of success rate, rating, and dispute penalty
      const successComponent = successRate * 0.50;
      const ratingComponent = ((avgRating - 1) / 4) * 0.35; // normalize 1-5 → 0-1
      const disputePenalty = disputeRate * 0.15;
      const score = Math.min(Math.max(successComponent + ratingComponent - disputePenalty, 0), 1);

      // Uncertainty based on attestation count
      const uncertainty =
        total <= 5  ? 0.6 :
        total <= 20 ? 0.3 :
                      0.1;
      const confidence = 1 - uncertainty;

      return [{
        provider: 'behavioral',
        signal_type: 'behavioral_reputation',
        score,
        confidence,
        evidence: {
          total_interactions: total,
          success_rate: Math.round(successRate * 10000) / 10000,
          avg_rating: Math.round(avgRating * 100) / 100,
          dispute_rate: Math.round(disputeRate * 10000) / 10000,
          successes,
          failures,
          disputed,
        },
        timestamp,
        ttl: 300,
      }];
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return [{
        provider: 'behavioral',
        signal_type: 'behavioral_reputation',
        score: 0.5,
        confidence: 0.0,
        evidence: { error: message },
        timestamp,
        ttl: 120,
      }];
    }
  }

  async health(): Promise<HealthStatus> {
    return {
      status: 'healthy',
      last_check: new Date().toISOString(),
      avg_response_ms: 0,
      error_rate_1h: 0,
    };
  }
}
