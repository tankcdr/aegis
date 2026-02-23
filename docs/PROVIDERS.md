# Signal Providers Guide

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
