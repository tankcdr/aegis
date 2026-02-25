# Signal Providers Guide

**Version:** 0.4.0-draft (aligned with SPEC v0.4.0)
**Last Updated:** 2026-02-25

This guide is the practical companion to **[SPEC.md §6 (Signal Provider Interface)](SPEC.md#6-signal-provider-interface)** and **[Appendix B (Signal Type Taxonomy)](SPEC.md#appendix-b-signal-type-taxonomy)**. See the spec for the formal protocol requirements and compliance rules.

---

## Overview

Signal providers are the data backbone of Aegis. Each provider is a module that evaluates a subject (agent, skill, or interaction) and returns structured trust signals with evidence. Providers are pluggable — anyone can build and register one.

## Provider Interface

Every provider MUST implement four methods:

### metadata()

Returns static information about the provider.

```typescript
interface ProviderMetadata {
  name: string;                    // Unique identifier (e.g., "github")
  version: string;                 // Semver version
  description: string;             // Human-readable description
  supported_subjects: SubjectType[]; // ["agent", "skill", "interaction"]
  supported_namespaces: string[];  // ["github", "clawhub", "npm"]
  signal_types: SignalTypeInfo[];   // What signals this provider produces
  rate_limit?: {
    requests_per_minute: number;
    burst: number;
  };
}
```

### evaluate(subject, context?)

The core method. Evaluates a subject and returns trust signals.

```typescript
interface EvaluateRequest {
  subject: {
    type: "agent" | "skill" | "interaction";
    namespace: string;
    id: string;
  };
  context?: {
    action?: string;
    risk_level?: string;
    permissions_requested?: string[];
    requester?: string;
  };
}

interface Signal {
  provider: string;
  signal_type: string;
  score: number;        // 0.0 to 1.0
  confidence: number;   // 0.0 to 1.0
  evidence: Record<string, any>;
  timestamp: string;    // ISO 8601
  ttl?: number;         // seconds
}

type EvaluateResponse = Signal[];

// Canonical provider interface — all four methods are required (SPEC §6.1)
interface Provider {
  metadata(): ProviderMetadata;
  evaluate(request: EvaluateRequest): Promise<Signal[]>;
  health(): Promise<HealthStatus>;    // SPEC §6.1
  supported(subject: Subject): boolean; // SPEC §6.1
}
```

### health()

Returns the provider's operational status.

```typescript
interface HealthStatus {
  status: "healthy" | "degraded" | "unhealthy";
  last_check: string;
  avg_response_ms: number;
  error_rate_1h: number;
  dependencies?: Record<string, "healthy" | "degraded" | "unhealthy">;
}
```

### supported(subject)

Quick check: can this provider evaluate the given subject?

```typescript
supported(subject: Subject): boolean
```

## Building a Provider

### Example: GitHub Provider

This walks through building the built-in GitHub provider.

#### Step 1: Define Metadata

```typescript
const metadata: ProviderMetadata = {
  name: "github",
  version: "1.0.0",
  description: "GitHub account and repository reputation analysis",
  supported_subjects: ["agent", "skill"],
  supported_namespaces: ["github", "clawhub", "npm"],
  signal_types: [
    {
      type: "author_reputation",
      description: "GitHub profile maturity, activity, and trust signals"
    },
    {
      type: "repo_health",
      description: "Repository maintenance, community, and security signals"
    }
  ],
  rate_limit: {
    requests_per_minute: 60,
    burst: 10
  }
};
```

#### Step 2: Implement evaluate()

```typescript
async function evaluate(subject: Subject, context?: Context): Promise<Signal[]> {
  const signals: Signal[] = [];

  // Resolve the GitHub identity
  const githubUser = await resolveGitHubUser(subject);
  if (!githubUser) {
    throw new Error(`Cannot resolve GitHub identity for ${subject.namespace}://${subject.id}`);
  }

  // Signal 1: Author Reputation
  const profile = await fetchGitHubProfile(githubUser);
  const reputationScore = computeReputationScore(profile);

  signals.push({
    provider: "github",
    signal_type: "author_reputation",
    score: reputationScore,
    confidence: profile.account_age_days > 365 ? 0.85 : 0.50,
    evidence: {
      account_age_days: profile.account_age_days,
      public_repos: profile.public_repos,
      followers: profile.followers,
      has_2fa: profile.two_factor_authentication,
      contributions_last_year: profile.contributions
    },
    timestamp: new Date().toISOString(),
    ttl: 86400 // 24 hours
  });

  // Signal 2: Repo Health (if subject is a skill/repo)
  if (subject.type === "skill") {
    const repo = await fetchGitHubRepo(subject);
    const healthScore = computeRepoHealthScore(repo);

    signals.push({
      provider: "github",
      signal_type: "repo_health",
      score: healthScore,
      confidence: 0.80,
      evidence: {
        stars: repo.stargazers_count,
        forks: repo.forks_count,
        open_issues: repo.open_issues_count,
        last_commit_days_ago: daysSince(repo.pushed_at),
        has_ci: repo.has_ci,
        license: repo.license?.spdx_id,
        archived: repo.archived
      },
      timestamp: new Date().toISOString(),
      ttl: 43200 // 12 hours
    });
  }

  return signals;
}
```

#### Step 3: Scoring Logic

```typescript
function computeReputationScore(profile: GitHubProfile): number {
  let score = 0.0;

  // Account age (max 0.25)
  const ageYears = profile.account_age_days / 365;
  score += Math.min(0.25, ageYears * 0.05);

  // Activity (max 0.25)
  const repoScore = Math.min(1.0, profile.public_repos / 50);
  score += repoScore * 0.25;

  // Social proof (max 0.20)
  const followerScore = Math.min(1.0, profile.followers / 100);
  score += followerScore * 0.20;

  // Security (max 0.15)
  if (profile.two_factor_authentication) score += 0.15;

  // Recent activity (max 0.15)
  const contributionScore = Math.min(1.0, profile.contributions / 200);
  score += contributionScore * 0.15;

  return Math.min(1.0, score);
}
```

### Registering a Remote Provider

If your provider runs as an external service, register it with an Aegis instance:

```bash
curl -X POST https://aegis.example/v1/providers/register \
  -H "Authorization: Bearer ${AEGIS_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "my_yara_scanner",
    "version": "1.0.0",
    "description": "YARA-based security scanner for agent skills",
    "endpoint": "https://scanner.example.com/aegis",
    "supported_subjects": ["skill"],
    "supported_namespaces": ["clawhub", "github", "npm"],
    "signal_types": ["security_scan"]
  }'
```

Your endpoint MUST implement:

| Method | Path | Description |
|--------|------|-------------|
| GET | /metadata | Return ProviderMetadata |
| POST | /evaluate | Evaluate a subject, return Signal[] |
| GET | /health | Return HealthStatus |
| POST | /supported | Return boolean |

### Provider Requirements

- Respond within 10 seconds (configurable per-instance)
- Return honest confidence values — low data means low confidence
- Include meaningful evidence — not just a score
- Handle errors gracefully — return an error signal rather than crashing
- Respect rate limits of upstream APIs you depend on
- Use TLS for all external communication

### Provider Verification

After registration, remote providers go through a verification process:

1. **Health check** — Aegis calls `/health` to confirm the endpoint is live
2. **Test evaluation** — Aegis sends a known test subject to validate response format
3. **Manual review** — For public instances, a maintainer reviews the provider

Once verified, the provider's status changes from `pending_verification` to `active` and it begins receiving evaluation requests during trust queries.

---

## Remote Providers (HTTP)

Third-party providers can be registered at runtime via the Aegis API (SPEC §5.3 `POST /v1/providers/register`). They must expose these four HTTP endpoints:

| Method | Path | Returns | Description |
|--------|------|---------|-------------|
| `GET` | `/metadata` | `ProviderMetadata` | Provider capabilities and rate limits |
| `POST` | `/evaluate` | `Signal[]` | Evaluate a subject and return trust signals |
| `GET` | `/health` | `HealthStatus` | Operational status of the provider |
| `POST` | `/supported` | `boolean` | Can this provider evaluate the given subject? |

See **[SPEC §6.3](SPEC.md#6-signal-provider-interface)** for full details and authentication options.

### Minimal Express.js Example

```typescript
import express from 'express';

const app = express();
app.use(express.json());

app.get('/metadata', (req, res) => res.json({
  name: 'my_provider',
  version: '1.0.0',
  description: 'Example remote provider',
  supported_subjects: ['agent', 'skill'],
  supported_namespaces: ['github'],
  signal_types: [{ type: 'author_reputation', description: 'GitHub author signals' }],
  rate_limit: { requests_per_minute: 60, burst: 10 }
}));

app.post('/evaluate', async (req, res) => {
  const { subject, context } = req.body;
  // ... compute signals ...
  res.json([{
    provider: 'my_provider',
    signal_type: 'author_reputation',
    score: 0.75,
    confidence: 0.80,
    evidence: { /* ... */ },
    timestamp: new Date().toISOString(),
    ttl: 86400
  }]);
});

app.get('/health', (req, res) => res.json({
  status: 'healthy',
  last_check: new Date().toISOString(),
  avg_response_ms: 120,
  error_rate_1h: 0.0
}));

app.post('/supported', (req, res) => {
  const { subject } = req.body;
  res.json(subject.namespace === 'github');
});

app.listen(3000);
```

### Security Requirements for Remote Providers

- **TLS required** — All endpoints MUST be served over HTTPS
- **Response timeout** — MUST respond within 10 seconds (configurable per Aegis instance)
- **Honest confidence** — Low data coverage MUST be reflected in low confidence values; do not report `confidence > 0.5` for a single data point
- **Graceful errors** — Return an error signal rather than a 5xx response where possible; Aegis marks non-responding providers as `unresolved`, not failed
- **Rate limit respect** — Honor the `rate_limit` declared in your metadata; Aegis will not throttle beyond it but you are responsible for upstream API limits

### Provider Health Monitoring

Aegis tracks provider health continuously:

- **Periodic health checks** — `GET /health` called every 60 seconds
- **Reliability metrics** — Aegis records response time and error rate per provider
- **Automatic demotion** — Providers with `error_rate_1h > 0.1` are demoted to `degraded` and their signals receive a 0.5× weight penalty
- **Suspension** — Providers with `error_rate_1h > 0.5` or sustained score distribution anomalies (see SPEC §11.2.2) are suspended automatically

Monitor your provider's standing via:

```bash
curl https://aegis.example/v1/providers/my_provider/health \
  -H "Authorization: Bearer ${AEGIS_API_KEY}"
```

---

## Best Practices & New Spec Requirements (v0.4+)

### Honest Confidence (SPEC §7.2)

If you only have one data point for a subject, set `confidence ≤ 0.5`. The Aegis scoring model treats confidence as the `1 - uncertainty` term in a Subjective Logic opinion tuple — overstating confidence inflates composite scores in ways that cannot be corrected downstream.

```typescript
// ✅ Correct — one data point = low confidence
signals.push({
  score: 0.85,
  confidence: 0.40,   // single GitHub profile fetch, limited history
  ...
});

// ❌ Wrong — fabricating certainty you don't have
signals.push({
  score: 0.85,
  confidence: 0.95,   // you only looked at one thing
  ...
});
```

Confidence SHOULD increase with: number of independent data points, account age, corroboration from multiple upstream sources, and recency of the data.

### Volatility Awareness (SPEC §7.9)

Subjects with ≥ 5 interactions in 30 days have an Evolutionary Stability Adjustment applied to their composite score:

```
effective_score = fused_score × (1 - 0.15 × volatility)
volatility      = stddev(recent_scores) / mean(recent_scores)
```

As a provider, **avoid returning erratic scores for the same subject over short periods**. If your upstream data source has high variance (e.g. a social karma feed that fluctuates hourly), smooth your output with a rolling average or increase your TTL to reduce intra-day noise. A provider that returns 0.90 on Monday and 0.30 on Tuesday for the same subject — without a real underlying change — will harm the subject's effective score through no fault of their own.

Good practice: set `ttl` high enough that your signal does not update faster than genuine trust can change.

| Signal Type | Recommended minimum TTL |
|-------------|------------------------|
| `author_reputation` | 86400s (24h) |
| `community_karma` | 43200s (12h) |
| `repo_health` | 43200s (12h) |
| `security_scan` | 604800s (7d) |
| `on_chain_reputation` | 3600s (1h) |
| `blind_feedback` | 3600s (1h) |

### Fraud Resistance (SPEC §12)

The Fraud Detection Engine runs cross-provider consistency checks on every evaluation. Signals that are wildly inconsistent with other providers' signals for the same subject will be flagged and may trigger a `cross_provider_inconsistency` fraud alert that overrides your signal's contribution.

**Do not fabricate or inflate signals.** Specifically:

- Do not return high scores for newly created accounts that have no real history
- Do not return inconsistent scores for the same subject across evaluations without a genuine underlying change
- Do not return uniform scores across all subjects — a provider that scores everything 0.80–0.85 looks like a compromised provider (see SPEC §11.2.2, Adversarial Test Vector D.2)

The scoring engine tracks your provider's historical score distribution. Sudden shifts in that distribution trigger automatic demotion and investigation.

### Context Awareness (SPEC §7.4)

The optional `context` field in evaluate requests is not decorative — use it to adjust your signals for the action being taken. An agent with a strong author reputation is not necessarily trustworthy for `filesystem` write access.

```typescript
async function evaluate(subject: Subject, context?: Context): Promise<Signal[]> {
  const baseScore = await computeBaseScore(subject);

  // Adjust for high-risk actions
  let score = baseScore;
  if (context?.permissions_requested?.includes('filesystem')) {
    score *= 0.85;  // require higher threshold for filesystem access
  }
  if (context?.risk_level === 'critical') {
    score *= 0.90;  // conservative adjustment in critical contexts
  }

  const confidence = computeConfidence(subject, context);

  return [{ score, confidence, ... }];
}
```

The action-based weight table in SPEC §7.4 shows which signal categories are boosted or reduced per action type — align your context adjustments with these weights.

### TTL and Cache Hygiene

- Always set `ttl` — providers without a TTL force Aegis to use a default of 3600s, which may be too short (causing unnecessary re-evaluation) or too long (serving stale signals) for your data source
- TTL SHOULD reflect the actual freshness of your upstream data, not a conservative safe value
- If your upstream data changes event-driven (e.g. a webhook triggers on new audit submission), set a shorter TTL and handle re-evaluation eagerly
- Do not set `ttl = 0` — this disables caching and will cause your provider to be called on every query, burning both your rate limits and Aegis query latency

---

## Testing

*Coming in v0.5 — will include:*
- Local provider test harness (mock Aegis engine)
- Conformance test suite aligned with [Appendix D adversarial vectors](SPEC.md#appendix-d-adversarial-test-vectors)
- Score distribution validator (catches D.2-style uniform scoring before registration)
- Integration test against the public Aegis staging instance
