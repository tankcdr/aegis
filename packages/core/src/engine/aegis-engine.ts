// AegisEngine — the embeddable trust engine (SPEC §4)
//
// Embedding example (OpenClaw, custom platform, etc.):
//   import { AegisEngine } from '@aegis-protocol/core';
//   const engine = new AegisEngine();
//   const result = await engine.query({
//     subject: { type: 'skill', namespace: 'github', id: 'author/skill' }
//   });

import type {
  AegisConfig,
  EvaluateRequest,
  FraudSignal,
  Provider,
  Signal,
  TrustResult,
} from '../types/index.js';
import { GitHubProvider } from '../providers/index.js';
import { TrustCache } from './cache.js';
import {
  applyContextMultiplier,
  evTrustAdjust,
  fuseOpinions,
  mapRecommendation,
  mapRiskLevel,
  projectScore,
  signalToOpinion,
} from './scoring.js';

export class AegisEngine {
  private readonly providers: Provider[];
  private readonly cache: TrustCache;
  private readonly providerTimeout: number;

  constructor(config: AegisConfig = {}) {
    // Default providers: GitHubProvider (Phase 1)
    this.providers =
      config.providers && config.providers.length > 0
        ? config.providers
        : [new GitHubProvider()];

    this.cache = new TrustCache(300);
    this.providerTimeout = config.scoring?.providerTimeout ?? 10_000;
  }

  async query(request: EvaluateRequest): Promise<TrustResult> {
    const { subject, context } = request;

    // ── Step 1: Identity resolution ────────────────────────────────────────────
    const subjectKey = `${subject.namespace}:${subject.id}`;

    // Check cache first
    const cached = this.cache.get(subjectKey);
    if (cached) return cached;

    // ── Step 2: Find eligible providers ───────────────────────────────────────
    const eligible = this.providers.filter((p) => p.supported(subject));

    if (eligible.length === 0) {
      const result: TrustResult = {
        subject: subjectKey,
        trust_score: 0,
        confidence: 0,
        risk_level: 'critical',
        recommendation: 'deny',
        signals: [],
        fraud_signals: [
          {
            type: 'no_providers',
            severity: 'critical',
            description: `No signal providers support namespace "${subject.namespace}"`,
            detected_at: new Date().toISOString(),
          },
        ],
        unresolved: [
          {
            provider: 'none',
            reason: `No providers support namespace "${subject.namespace}"`,
          },
        ],
        evaluated_at: new Date().toISOString(),
        metadata: { query_id: crypto.randomUUID() },
      };
      return result;
    }

    // ── Step 3: Signal dispatch (parallel fan-out with timeout) ────────────────
    const allSignals: Signal[] = [];
    const unresolved: Array<{ provider: string; reason: string }> = [];

    const providerResults = await Promise.allSettled(
      eligible.map((provider) =>
        Promise.race([
          provider.evaluate(request),
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error(`Timeout after ${this.providerTimeout}ms`)),
              this.providerTimeout,
            ),
          ),
        ]).then((signals) => ({ provider, signals })),
      ),
    );

    for (const outcome of providerResults) {
      if (outcome.status === 'fulfilled') {
        allSignals.push(...outcome.value.signals);
      } else {
        const meta = eligible[providerResults.indexOf(outcome)];
        unresolved.push({
          provider: meta?.metadata().name ?? 'unknown',
          reason: outcome.reason instanceof Error
            ? outcome.reason.message
            : String(outcome.reason),
        });
      }
    }

    // ── Step 4: Fraud detection (Phase 1 — lightweight heuristics) ────────────
    const fraudSignals: FraudSignal[] = [];
    const now = new Date().toISOString();

    if (allSignals.length === 0) {
      fraudSignals.push({
        type: 'no_signals',
        severity: 'high',
        description: 'No signals could be collected for this subject',
        detected_at: now,
      });
    }

    for (const signal of allSignals) {
      if (signal.score < 0.1 && signal.confidence > 0.7) {
        fraudSignals.push({
          type: 'low_trust_signal',
          severity: 'medium',
          description: `Provider "${signal.provider}" returned very low trust (${signal.score.toFixed(2)}) with high confidence (${signal.confidence.toFixed(2)}) — signal: ${signal.signal_type}`,
          evidence: { signal_type: signal.signal_type, score: signal.score, confidence: signal.confidence },
          detected_at: now,
        });
      }
    }

    // ── Step 5: Subjective Logic opinion fusion ────────────────────────────────
    const opinions = allSignals.map(signalToOpinion);
    const fusedOpinion = fuseOpinions(opinions);
    const rawScore = projectScore(fusedOpinion);

    // ── Step 6: Ev-Trust evolutionary stability adjustment (λ = 0.15) ──────────
    const adjustedScore = evTrustAdjust(rawScore, allSignals);

    // ── Step 7: Risk level mapping + context multiplier ────────────────────────
    let riskLevel = mapRiskLevel(adjustedScore);
    riskLevel = applyContextMultiplier(riskLevel, context?.action);
    const recommendation = mapRecommendation(riskLevel, adjustedScore);

    // Derive effective TTL from minimum signal TTL (default 300s)
    const ttl =
      allSignals.length > 0
        ? Math.min(...allSignals.map((s) => s.ttl ?? 300))
        : 300;

    const result: TrustResult = {
      subject: subjectKey,
      trust_score: Math.round(adjustedScore * 10_000) / 10_000,
      confidence: Math.round((1 - fusedOpinion.uncertainty) * 10_000) / 10_000,
      risk_level: riskLevel,
      recommendation,
      signals: allSignals,
      fraud_signals: fraudSignals,
      unresolved,
      evaluated_at: new Date().toISOString(),
      metadata: { query_id: crypto.randomUUID() },
    };

    // Store in cache
    this.cache.set(subjectKey, result, ttl);

    return result;
  }

  /** Invalidate a cached result, forcing a fresh evaluation on next query. */
  invalidate(subjectKey: string): void {
    this.cache.invalidate(subjectKey);
  }

  /** Health check across all registered providers. */
  async health(): Promise<
    Array<{ provider: string; status: string; last_check: string }>
  > {
    return Promise.all(
      this.providers.map(async (p) => {
        try {
          const h = await p.health();
          return { provider: p.metadata().name, status: h.status, last_check: h.last_check };
        } catch {
          return {
            provider: p.metadata().name,
            status: 'unhealthy',
            last_check: new Date().toISOString(),
          };
        }
      }),
    );
  }

  /** Names of all registered providers. */
  providerNames(): string[] {
    return this.providers.map((p) => p.metadata().name);
  }
}
