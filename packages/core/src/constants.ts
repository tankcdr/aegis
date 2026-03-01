/**
 * Centralized constants for TrstLyr scoring engine.
 * All magic numbers live here — change once, applies everywhere.
 */

// ── Cache TTLs (seconds) ──────────────────────────────────────────────────────
export const TTL = {
  /** Default engine result cache TTL */
  DEFAULT:        300,
  /** On-chain data (ERC-8004) — stable, cache longer */
  ON_CHAIN:       3600,
  /** Off-chain API data (GitHub, ClawHub, Moltbook, Twitter) */
  OFF_CHAIN:      1800,
  /** Error / not-found fallback TTL — retry sooner */
  ERROR:          120,
} as const;

// ── HTTP / Network ────────────────────────────────────────────────────────────
export const HTTP = {
  /** Default provider fetch timeout (ms) */
  TIMEOUT_MS:     10_000,
} as const;

// ── Ev-Trust (arXiv:2512.16167v2) ────────────────────────────────────────────
export const EV_TRUST = {
  /**
   * λ = 0.15 — stable honest equilibrium per arXiv:2512.16167v2 §4.
   * Valid range: [0.1, 0.2].
   */
  LAMBDA:         0.15,
  /** Only apply Ev-Trust penalty when opinion spread exceeds this threshold */
  RANGE_THRESHOLD: 0.4,
} as const;

// ── Risk level thresholds (0–1 internal score) ───────────────────────────────
export const RISK = {
  MINIMAL:        0.8,
  LOW:            0.6,
  MEDIUM:         0.4,
  HIGH:           0.2,
} as const;

// ── Subjective Logic defaults ─────────────────────────────────────────────────
export const SL = {
  /** Prior base rate — neutral assumption */
  BASE_RATE:      0.5,
} as const;

// ── Fraud signal thresholds ───────────────────────────────────────────────────
export const FRAUD = {
  /** Flag a signal as suspicious when score is below this and confidence is above HIGH_CONFIDENCE */
  LOW_SCORE:      0.1,
  HIGH_CONFIDENCE: 0.7,
} as const;

// ── GitHub provider weights ───────────────────────────────────────────────────
export const GITHUB = {
  AUTHOR: {
    FOLLOWER_WEIGHT:  0.30,
    FOLLOWER_MAX:     1000,
    REPO_WEIGHT:      0.20,
    REPO_MAX:         50,
    AGE_WEIGHT:       0.30,
    AGE_MAX_DAYS:     730,
    HIREABLE_BONUS:   0.10,
    BLOG_BONUS:       0.05,
    TWITTER_BONUS:    0.05,
  },
} as const;

// ── ClawHub provider weights ──────────────────────────────────────────────────
export const CLAWHUB = {
  SKILL: {
    INSTALL_WEIGHT:   0.35,
    INSTALL_MAX:      200,
    STAR_WEIGHT:      0.25,
    STAR_MAX:         100,
    DOWNLOAD_WEIGHT:  0.15,
    DOWNLOAD_MAX:     5000,
    COMMENT_WEIGHT:   0.10,
    COMMENT_MAX:      20,
    VERSION_WEIGHT:   0.05,
    VERSION_MAX:      5,
    RECENCY_WEIGHT:   0.10,
    RECENCY_MAX_DAYS: 180,
    VERIFIED_CONFIDENCE: 0.95,
    BASE_CONFIDENCE:  0.40,
    CONFIDENCE_MAX:   0.92,
    INSTALL_CONFIDENCE_DIVISOR: 400,
  },
  AUTHOR: {
    PORTFOLIO_WEIGHT: 0.15,
    PORTFOLIO_MAX:    10,
    INSTALL_WEIGHT:   0.35,
    INSTALL_MAX:      1000,
    STAR_WEIGHT:      0.20,
    STAR_MAX:         200,
    DOWNLOAD_WEIGHT:  0.15,
    DOWNLOAD_MAX:     10_000,
    BREAKOUT_WEIGHT:  0.10,
    BREAKOUT_MAX:     500,
    ENGAGEMENT_WEIGHT: 0.05,
    ENGAGEMENT_MAX:   30,
    BASE_CONFIDENCE:  0.40,
    CONFIDENCE_MAX:   0.90,
    CONFIDENCE_DIVISOR: 2000,
  },
} as const;

// ── ERC-8004 provider weights ─────────────────────────────────────────────────
export const ERC8004 = {
  REGISTRATION: {
    ACTIVE_WEIGHT:      0.40,
    NAME_WEIGHT:        0.20,
    DESCRIPTION_WEIGHT: 0.25,
    TRUST_WEIGHT:       0.15,
  },
  SERVICE_DIVERSITY: {
    A2A_WEIGHT:   0.25,
    MCP_WEIGHT:   0.25,
    ENS_WEIGHT:   0.15,
    DID_WEIGHT:   0.15,
    WEB_WEIGHT:   0.10,
    EMAIL_WEIGHT: 0.10,
    COUNT_WEIGHT: 0.10,
    COUNT_MAX:    10,
    WITH_SERVICES_CONFIDENCE:    0.9,
    WITHOUT_SERVICES_CONFIDENCE: 0.5,
  },
  COLD_START_CONFIDENCE: 0.5,
  COLD_START_TTL:        300,
} as const;
