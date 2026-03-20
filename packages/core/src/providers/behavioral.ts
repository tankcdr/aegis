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
//
// Identity deduplication: when a LinkedSubjectResolver is provided, the provider
// fetches attestations for ALL linked identifiers in a single aggregated pass,
// then returns ONE signal. This prevents double-counting when the engine fans out
// across linked identities (e.g. github:tankcdr + erc8004:31977 → one behavioral signal).

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

/**
 * Optional resolver: given a subject key, returns all linked subject keys
 * (including the original). Used to aggregate attestations across identities.
 * When not provided, only the queried subject key is used.
 */
export type LinkedSubjectResolver = (subjectKey: string) => string[];

export class BehavioralProvider implements Provider {
  private readonly fetchAttestations: BehavioralFetcher;
  private readonly resolveLinked: LinkedSubjectResolver | undefined;

  /**
   * @param fetcher         DB fetch function — returns attestations for a subject key
   * @param resolveLinked   Optional: returns all linked subject keys for a given key.
   *                        When provided, attestations are aggregated across all linked
   *                        identities and a single deduplicated signal is returned.
   *                        The provider will skip evaluation for non-canonical subjects
   *                        (i.e. subjects that appear as a linked identity of another)
   *                        to prevent double-counting.
   */
  constructor(fetcher: BehavioralFetcher, resolveLinked?: LinkedSubjectResolver) {
    this.fetchAttestations = fetcher;
    this.resolveLinked = resolveLinked;
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
    // Behavioral attestations can exist for any namespace.
    // When a linked resolver is configured, we only respond to the "canonical"
    // subject — defined as one that is NOT listed purely as a linked alias of
    // another subject already in the dispatch list. In practice the engine calls
    // us once per linked identity; we use the resolver to detect when we've
    // already been called for a more-canonical form of this subject (by checking
    // whether this subject key appears as a linked result of any other subject).
    // The simplest safe heuristic: always return true here and deduplicate inside
    // evaluate() by fetching all linked keys at once and returning [] for
    // non-primary calls (detected via a seen-set on the engine's identity graph).
    //
    // Actual dedup is handled in evaluate() — we return an empty array for any
    // linked-identity call that would duplicate a prior result.
    return true;
  }

  async evaluate(request: EvaluateRequest): Promise<Signal[]> {
    const { subject } = request;
    const subjectKey = `${subject.namespace}:${subject.id}`;
    const timestamp = new Date().toISOString();

    // ── Identity-aware aggregation ─────────────────────────────────────────────
    // When a resolver is provided, collect all linked subject keys and fetch
    // attestations for all of them in parallel. Return [] for any call that
    // is not the "lowest" (alphabetically first) key in the linked set — this
    // ensures exactly one signal is produced regardless of how many times the
    // engine calls us across linked identities.
    let subjectKeysToFetch: string[];

    if (this.resolveLinked) {
      const allKeys = this.resolveLinked(subjectKey);
      // Canonical = alphabetically smallest key — deterministic, stable
      const canonical = [...allKeys].sort()[0] ?? subjectKey;
      if (subjectKey !== canonical) {
        // This is a linked alias — the canonical call will handle aggregation
        return [];
      }
      subjectKeysToFetch = allKeys;
    } else {
      subjectKeysToFetch = [subjectKey];
    }

    try {
      // Fetch attestations for all linked subjects in parallel, deduplicate by id
      const allRowArrays = await Promise.all(
        subjectKeysToFetch.map(k => this.fetchAttestations(k))
      );
      const seen = new Set<string>();
      const rows: BehavioralRow[] = [];
      for (const arr of allRowArrays) {
        for (const row of arr) {
          const dedupKey = row.id ?? `${row.attester}:${row.interaction_at}:${row.subject}`;
          if (!seen.has(dedupKey)) {
            seen.add(dedupKey);
            rows.push(row);
          }
        }
      }

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
