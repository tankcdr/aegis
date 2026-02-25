// @aegis-protocol/core — public API

// ── Engine ───────────────────────────────────────────────────────────────────
export { AegisEngine, TrustCache } from './engine/index.js';
export {
  applyContextMultiplier,
  evTrustAdjust,
  fuseOpinions,
  fuseTwo,
  mapRecommendation,
  mapRiskLevel,
  projectScore,
  signalToOpinion,
} from './engine/index.js';

// ── Providers ────────────────────────────────────────────────────────────────
export { GitHubProvider } from './providers/index.js';

// ── Types ────────────────────────────────────────────────────────────────────
export type {
  Action,
  AegisConfig,
  Context,
  EvaluateRequest,
  FraudSignal,
  HealthStatus,
  Opinion,
  Provider,
  ProviderMetadata,
  RecommendationType,
  RiskLevel,
  RiskLevelResult,
  Signal,
  Subject,
  SubjectType,
  TrustResult,
} from './types/index.js';
