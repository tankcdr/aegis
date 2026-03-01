import { EV_TRUST, RISK, SL } from '../constants.js';
// Scoring engine — Subjective Logic opinion fusion + Ev-Trust adjustment
// SPEC §7 — Trust Scoring Model

import type {
  EntityType,
  Opinion,
  RecommendationType,
  RiskLevelResult,
  Signal,
} from '../types/index.js';

// ─── Signal → Opinion ─────────────────────────────────────────────────────────

/**
 * Convert a Signal to a Subjective Logic opinion (b, d, u, a).
 * SPEC §7.1 — opinion tuple derivation.
 */
export function signalToOpinion(signal: Signal): Opinion {
  const c = Math.min(Math.max(signal.confidence, 0), 1);
  const s = Math.min(Math.max(signal.score, 0), 1);
  return {
    belief: s * c,
    disbelief: (1 - s) * c,
    uncertainty: 1 - c,
    baseRate: SL.BASE_RATE,
  };
}

// ─── Cumulative Belief Fusion ─────────────────────────────────────────────────

/**
 * Fuse two Subjective Logic opinions using the Cumulative Belief Fusion (CBF)
 * operator. SPEC §7.4 — Jøsang 2001.
 */
export function fuseTwo(a: Opinion, b: Opinion): Opinion {
  const denom = a.uncertainty + b.uncertainty - a.uncertainty * b.uncertainty;

  // Both certainties maxed out (u_A = u_B = 0) → dogmatic fusion: simple average
  if (denom < 1e-10) {
    return {
      belief: (a.belief + b.belief) / 2,
      disbelief: (a.disbelief + b.disbelief) / 2,
      uncertainty: 0,
      baseRate: (a.baseRate + b.baseRate) / 2,
    };
  }

  const aDenomBase =
    denom - 2 * a.uncertainty * b.uncertainty;

  return {
    belief:
      (a.belief * b.uncertainty + b.belief * a.uncertainty) / denom,
    disbelief:
      (a.disbelief * b.uncertainty + b.disbelief * a.uncertainty) / denom,
    uncertainty: (a.uncertainty * b.uncertainty) / denom,
    baseRate:
      Math.abs(aDenomBase) > 1e-10
        ? (a.baseRate * b.uncertainty +
            b.baseRate * a.uncertainty -
            (a.baseRate + b.baseRate) * a.uncertainty * b.uncertainty) /
          aDenomBase
        : (a.baseRate + b.baseRate) / 2,
  };
}

/**
 * Fuse N opinions using cumulative belief fusion.
 * Returns vacuous opinion (full uncertainty) when no opinions provided.
 */
export function fuseOpinions(opinions: Opinion[]): Opinion {
  if (opinions.length === 0) {
    return { belief: 0, disbelief: 0, uncertainty: 1, baseRate: SL.BASE_RATE };
  }
  if (opinions.length === 1) return opinions[0]!;
  return opinions.slice(1).reduce((acc, op) => fuseTwo(acc, op), opinions[0]!);
}

// ─── Projection ───────────────────────────────────────────────────────────────

/**
 * Project a SL opinion to a single trust score: b + a·u
 * SPEC §7.2
 */
export function projectScore(opinion: Opinion): number {
  return Math.min(Math.max(opinion.belief + opinion.baseRate * opinion.uncertainty, 0), 1);
}

// ─── Ev-Trust Evolutionary Stability Adjustment ───────────────────────────────

/**
 * Apply Ev-Trust penalty when signals disagree significantly.
 * λ = 0.15 per arXiv:2512.16167v2 stable equilibrium range [0.1, 0.2].
 * SPEC §7.9
 */
export function evTrustAdjust(score: number, signals: Signal[]): number {
  if (signals.length < 2) return score;

  const scores = signals.map((s) => s.score);
  const range = Math.max(...scores) - Math.min(...scores);

  // Only penalise when disagreement is substantial (> 0.4 range)
  if (range > EV_TRUST.RANGE_THRESHOLD) {
    const lambda = EV_TRUST.LAMBDA;
    return score * (1 - lambda * range);
  }

  return score;
}

// ─── Risk Level Mapping ───────────────────────────────────────────────────────

/**
 * Map projected trust score to risk level. SPEC §7.7
 */
export function mapRiskLevel(score: number): RiskLevelResult {
  if (score >= RISK.MINIMAL) return 'minimal';
  if (score >= RISK.LOW)     return 'low';
  if (score >= RISK.MEDIUM)  return 'medium';
  if (score >= RISK.HIGH)    return 'high';
  return 'critical';
}

/**
 * Map risk level + score to a human-readable recommendation.
 */
export function mapRecommendation(
  riskLevel: RiskLevelResult,
  score: number,
): RecommendationType {
  switch (riskLevel) {
    case 'minimal':
      return 'allow';
    case 'low':
      return score >= 0.7 ? 'install' : 'allow';
    case 'medium':
      return 'review';
    case 'high':
      return 'caution';
    case 'critical':
      return 'deny';
  }
}

/**
 * Bump risk level up by one step for high-stakes actions (transact, delegate).
 * SPEC §7.7 — context multiplier.
 */
export function applyContextMultiplier(
  riskLevel: RiskLevelResult,
  action?: string,
): RiskLevelResult {
  if (action !== 'transact' && action !== 'delegate') return riskLevel;

  const escalation: Record<RiskLevelResult, RiskLevelResult> = {
    minimal: 'low',
    low: 'medium',
    medium: 'high',
    high: 'critical',
    critical: 'critical',
  };

  return escalation[riskLevel];
}

// ─── Entity Type Detection ────────────────────────────────────────────────────


/**
 * Detect what kind of entity a subject represents based on namespace + id.
 * Drives human-readable recommendation labels.
 */
export function detectEntityType(namespace: string, id: string): EntityType {
  switch (namespace) {
    case 'erc8004':
    case 'twitter':
    case 'x':
    case 'moltbook':
      return 'agent';

    case 'clawhub':
      // clawhub:skill/weather → skill; clawhub:author → developer
      return id.startsWith('skill/') || id.includes('/') ? 'skill' : 'developer';

    case 'github':
      // github:owner/repo → repo; github:owner → developer
      return id.includes('/') ? 'repo' : 'developer';

    case 'email':
    case 'did':
    case 'ens':
    case 'wallet':
    case 'eth':
      return 'agent';

    default:
      return 'unknown';
  }
}

/**
 * Map a machine-readable recommendation + entity type to a human-readable label.
 * Keeps the API stable (recommendation stays as-is) while surfacing context-aware text.
 */
export function recommendationLabel(
  recommendation: RecommendationType,
  entityType: EntityType,
): string {
  const labels: Record<EntityType, Record<RecommendationType, string>> = {
    agent: {
      allow:   '✅ Safe to interact',
      install: '✅ Safe to delegate',
      review:  '👀 Verify before trusting',
      caution: '⚠️ Proceed carefully',
      deny:    '🚫 Do not interact',
    },
    repo: {
      allow:   '✅ Allow',
      install: '✅ Safe to install',
      review:  '👀 Review before installing',
      caution: '⚠️ Use with caution',
      deny:    '🚫 Do not install',
    },
    skill: {
      allow:   '✅ Allow',
      install: '✅ Safe to install',
      review:  '👀 Review before installing',
      caution: '⚠️ Use with caution',
      deny:    '🚫 Do not install',
    },
    developer: {
      allow:   '✅ Reputable',
      install: '✅ Well established',
      review:  '👀 Verify identity',
      caution: '⚠️ Low reputation',
      deny:    '🚫 Avoid',
    },
    unknown: {
      allow:   '✅ Allow',
      install: '✅ Proceed',
      review:  '👀 Review',
      caution: '⚠️ Use with caution',
      deny:    '🚫 Deny',
    },
  };

  return labels[entityType][recommendation];
}
