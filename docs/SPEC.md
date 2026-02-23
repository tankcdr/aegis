# Aegis Protocol Specification

**Version:** 0.1.0-draft  
**Authors:** Chris Madison (Long Run Advisory)  
**Created:** 2026-02-23  
**Status:** Draft  

---

## Table of Contents

1. [Problem Statement](#1-problem-statement)
2. [Design Principles](#2-design-principles)
3. [Core Concepts](#3-core-concepts)
4. [Architecture](#4-architecture)
5. [API Specification](#5-api-specification)
6. [Signal Provider Interface](#6-signal-provider-interface)
7. [Trust Scoring Model](#7-trust-scoring-model)
8. [Identity Resolution](#8-identity-resolution)
9. [Web3 Bridge](#9-web3-bridge)
10. [Security Considerations](#10-security-considerations)
11. [Roadmap](#11-roadmap)

---

## 1. Problem Statement

The agent internet is growing rapidly. As of early 2026:

- **ClawHub** hosts 286+ skills for OpenClaw agents
- **Moltbook** has 1,261+ registered agents
- **MCP** (Model Context Protocol) enables tool/resource sharing across agent boundaries
- **A2A** (Agent-to-Agent) handles cross-organizational agent communication
- **ERC-8004** proposes on-chain agent discovery and trust

None of these ecosystems have adequate trust infrastructure.

### 1.1 The Current State

Skills published to ClawHub are unsigned. There is no identity verification for authors, no reputation system, no audit trail, and no permission manifest declaring what a skill accesses. An agent installing a skill from ClawHub is trusting an unknown author with full access to its runtime environment.

This is not theoretical. A credential stealer was discovered on ClawHub in January 2026, disguised as a weather skill. It read agent credentials from `~/.clawdbot/.env` and exfiltrated them to an external webhook. Out of 286 skills, one was malicious. The detection was accidental — a community member ran YARA rules as a personal project.

### 1.2 Why Existing Solutions Are Insufficient

**Static analysis tools** (ClawSec, skill-audit) scan skill code for known patterns. They are useful but insufficient — they catch known-bad patterns, not novel attacks. They operate point-in-time with no ongoing monitoring.

**ERC-8004** proposes a comprehensive on-chain trust framework with identity, reputation, and validation registries. It is well-designed but requires blockchain participation. Most agents today have no wallet, no on-chain identity, and no mechanism to pay gas fees. Requiring on-chain registration creates a barrier that excludes the majority of the current ecosystem.

**Platform-specific reputation** (Moltbook karma, GitHub stars) exists but is siloed. An agent's reputation on Moltbook tells you nothing about their skill on ClawHub. There is no cross-platform reputation portability.

### 1.3 What Is Needed

A trust layer that:

- Works today with web2 identities (GitHub accounts, platform profiles)
- Scales into web3 trust (on-chain reputation, staked validation) when stakes justify it
- Aggregates trust signals across platforms into a single assessment
- Provides transparent, evidence-backed trust scores
- Is open, composable, and embeddable by any platform

---

## 2. Design Principles

### 2.1 Web2/Web3 Agnostic

Aegis MUST operate without requiring blockchain participation. An agent with only a GitHub account MUST be able to receive a trust score. On-chain identity and reputation SHOULD enhance trust scores when available but MUST NOT be required for basic functionality.

### 2.2 Pluggable Signal Providers

Trust signals MUST be sourced through a standardized provider interface. Any party MUST be able to implement and register a new signal provider. The core protocol MUST NOT be coupled to any specific signal source.

### 2.3 Progressive Trust

Security requirements SHOULD be proportional to value at risk. Low-stakes interactions (browsing a skill's description) MAY rely on web2 signals alone. High-stakes interactions (installing a skill with filesystem access, delegating financial transactions) SHOULD require stronger trust signals (multiple audits, on-chain attestations, staked validation).

### 2.4 Transparency

Every trust score MUST include the signals that contributed to it, their individual scores, and the evidence backing each signal. Consumers MUST be able to inspect why a particular score was assigned. No black-box scoring.

### 2.5 Composability

Aegis MUST be embeddable by platforms. ClawHub, Moltbook, OpenClaw, or any agent framework SHOULD be able to integrate Aegis as their trust layer without forking or modifying the protocol. The API MUST be stateless and cacheable where appropriate.

---

## 3. Core Concepts

### 3.1 Subject

A **Subject** is any entity being evaluated for trust. Subjects are identified by a type and a namespaced identifier.

**Subject Types:**
- `agent` — An autonomous agent (e.g., a Moltbook profile, an ERC-8004 registered agent)
- `skill` — A capability package (e.g., a ClawHub skill, an npm package)
- `interaction` — A specific proposed action between entities

**Subject Identifier Format:**
```
{namespace}://{id}
```

Examples:
- `github://tankcdr`
- `moltbook://nyx_clawd`
- `clawhub://eudaemon_0/security-scanner`
- `erc8004://eip155:8453:0x742.../42`
- `npm://@openclaw/weather-skill`
- `did://did:key:z6Mk...`

### 3.2 Signal

A **Signal** is a single trust data point produced by a signal provider about a subject.

```json
{
  "provider": "github",
  "signal_type": "author_reputation",
  "score": 0.91,
  "confidence": 0.85,
  "evidence": {
    "account_age_days": 1140,
    "public_repos": 214,
    "followers": 892,
    "has_2fa": true
  },
  "timestamp": "2026-02-23T14:00:00Z",
  "ttl": 86400
}
```

Fields:
- `provider` (string, REQUIRED) — Identifier of the signal provider
- `signal_type` (string, REQUIRED) — Type of signal (provider-defined taxonomy)
- `score` (number, REQUIRED) — Normalized score from 0.0 (no trust) to 1.0 (full trust)
- `confidence` (number, REQUIRED) — Provider's confidence in this signal, 0.0 to 1.0
- `evidence` (object, REQUIRED) — Structured data backing the score. Schema is provider-defined.
- `timestamp` (string, REQUIRED) — ISO 8601 timestamp of when the signal was produced
- `ttl` (integer, OPTIONAL) — Time-to-live in seconds. After expiry, the signal SHOULD be re-evaluated.

### 3.3 Provider

A **Provider** is a module that evaluates subjects and produces signals. Providers implement the Signal Provider Interface (Section 6). Providers are registered with an Aegis instance and are invoked during trust queries.

### 3.4 Trust Score

A **Trust Score** is a composite assessment produced by the Trust Aggregation Engine from multiple signals. It represents the protocol's overall trust evaluation of a subject in a given context.

```json
{
  "trust_score": 0.87,
  "confidence": 0.72,
  "risk_level": "low",
  "recommendation": "install"
}
```

Fields:
- `trust_score` (number, REQUIRED) — Composite score, 0.0 to 1.0
- `confidence` (number, REQUIRED) — Composite confidence, 0.0 to 1.0. Reflects quantity and quality of available signals.
- `risk_level` (string, REQUIRED) — One of: `critical`, `high`, `medium`, `low`, `minimal`
- `recommendation` (string, REQUIRED) — One of: `allow`, `install`, `review`, `caution`, `deny`

### 3.5 Attestation

An **Attestation** is an optional on-chain anchor of a trust evaluation. Attestations provide immutable, verifiable proof that a trust assessment was made at a specific time with specific evidence. They are the bridge between web2 trust signals and web3 verifiability.

### 3.6 Context

A **Context** describes the circumstances of a trust query, enabling risk-adjusted scoring.

```json
{
  "action": "install",
  "risk_level": "high",
  "permissions_requested": ["filesystem", "network"],
  "requester": "moltbook://nyx_clawd"
}
```

---

## 4. Architecture

### 4.1 Components

```
┌─────────────────────────────────────────────────┐
│                 Trust Query API                  │
│          REST endpoints (Section 5)              │
└────────────────────┬────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────┐
│           Trust Aggregation Engine               │
│  ┌─────────────┐ ┌──────────┐ ┌──────────────┐  │
│  │ Signal      │ │ Scoring  │ │ Cache        │  │
│  │ Dispatcher  │ │ Engine   │ │ Layer        │  │
│  └──────┬──────┘ └──────────┘ └──────────────┘  │
└─────────┼───────────────────────────────────────┘
          │
┌─────────▼───────────────────────────────────────┐
│             Signal Provider Registry             │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌──────────┐  │
│  │ GitHub │ │Moltbook│ │ClawHub │ │ ERC-8004 │  │
│  └────────┘ └────────┘ └────────┘ └──────────┘  │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌──────────┐  │
│  │  npm   │ │  YARA  │ │  TEE   │ │  Manual  │  │
│  └────────┘ └────────┘ └────────┘ └──────────┘  │
└─────────────────────────────────────────────────┘
          │
┌─────────▼───────────────────────────────────────┐
│            Identity Resolution Layer             │
│     Cross-namespace identity linking & graph     │
└─────────────────────────────────────────────────┘
          │
┌─────────▼───────────────────────────────────────┐
│             Attestation Bridge                   │
│     Optional on-chain anchoring (ERC-8004)       │
└─────────────────────────────────────────────────┘
```

### 4.2 Trust Query Flow

1. Client sends a trust query to the API with a subject and optional context.
2. The Identity Resolution Layer resolves the subject across namespaces, discovering linked identities.
3. The Signal Dispatcher fans out requests to all registered providers that support the subject type and namespace(s).
4. Providers evaluate the subject independently and return signals.
5. The Scoring Engine normalizes, weights, and composes signals into a Trust Score, adjusted for the query context.
6. The Cache Layer stores the result for the signal TTL duration.
7. The response is returned with the composite score, all contributing signals, and any unresolved providers.

### 4.3 Deployment Models

Aegis supports three deployment models:

- **Public Instance** — A shared, hosted Aegis service. Suitable for general use. Operated by the community or a foundation.
- **Self-Hosted** — An organization runs their own Aegis instance with their own provider configuration and scoring weights.
- **Embedded** — A platform (e.g., ClawHub) integrates the Aegis engine as a library, running trust evaluation in-process.

---

## 5. API Specification

Base URL: `https://{host}/v1`

All request and response bodies use `application/json`. All timestamps are ISO 8601 UTC.

### 5.1 Trust Queries

#### POST /v1/trust/query

Full trust evaluation with context. This is the primary endpoint.

**Request:**

```json
{
  "subject": {
    "type": "skill",
    "namespace": "clawhub",
    "id": "eudaemon_0/security-scanner"
  },
  "context": {
    "action": "install",
    "risk_level": "high",
    "permissions_requested": ["filesystem", "network"],
    "requester": "moltbook://nyx_clawd"
  },
  "options": {
    "providers": ["github", "moltbook", "community_audit"],
    "min_confidence": 0.5,
    "include_evidence": true,
    "timeout_ms": 5000
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `subject` | object | REQUIRED | The entity to evaluate |
| `subject.type` | string | REQUIRED | One of: `agent`, `skill`, `interaction` |
| `subject.namespace` | string | REQUIRED | Source namespace (e.g., `github`, `clawhub`, `moltbook`, `erc8004`, `npm`, `did`) |
| `subject.id` | string | REQUIRED | Identifier within the namespace |
| `context` | object | OPTIONAL | Contextual information for risk-adjusted scoring |
| `context.action` | string | OPTIONAL | The action being evaluated (e.g., `install`, `execute`, `delegate`, `transact`) |
| `context.risk_level` | string | OPTIONAL | Caller's assessment: `critical`, `high`, `medium`, `low` |
| `context.permissions_requested` | array | OPTIONAL | Permissions the subject would receive |
| `context.requester` | string | OPTIONAL | Identity of the entity making the trust decision |
| `options` | object | OPTIONAL | Query options |
| `options.providers` | array | OPTIONAL | Limit evaluation to specific providers. If omitted, all applicable providers are used. |
| `options.min_confidence` | number | OPTIONAL | Minimum confidence threshold. Signals below this are excluded. Default: 0.0 |
| `options.include_evidence` | boolean | OPTIONAL | Include evidence objects in response. Default: true |
| `options.timeout_ms` | integer | OPTIONAL | Maximum time to wait for provider responses. Default: 10000 |

**Response (200 OK):**

```json
{
  "subject": "clawhub://eudaemon_0/security-scanner",
  "trust_score": 0.87,
  "confidence": 0.72,
  "risk_level": "low",
  "recommendation": "install",
  "signals": [
    {
      "provider": "github",
      "signal_type": "author_reputation",
      "score": 0.91,
      "confidence": 0.85,
      "evidence": {
        "account_age_days": 1140,
        "public_repos": 214,
        "followers": 892,
        "has_2fa": true
      },
      "timestamp": "2026-02-23T14:00:00Z"
    },
    {
      "provider": "moltbook",
      "signal_type": "community_karma",
      "score": 0.88,
      "confidence": 0.70,
      "evidence": {
        "karma": 6855,
        "posts": 47,
        "account_verified": true,
        "account_age_days": 180
      },
      "timestamp": "2026-02-23T14:00:00Z"
    },
    {
      "provider": "community_audit",
      "signal_type": "security_scan",
      "score": 0.85,
      "confidence": 0.60,
      "evidence": {
        "auditors": 3,
        "critical_findings": 0,
        "warning_findings": 1,
        "last_audit": "2026-02-20T10:30:00Z",
        "audit_tool": "yara-4.3"
      },
      "timestamp": "2026-02-23T14:00:00Z"
    }
  ],
  "unresolved": [
    {
      "provider": "erc8004",
      "reason": "no_on_chain_identity",
      "impact": "On-chain reputation unavailable. Trust score based on web2 signals only."
    }
  ],
  "identity": {
    "resolved_namespaces": ["github", "moltbook", "clawhub"],
    "linked_identities": [
      "github://eudaemon_0",
      "moltbook://eudaemon_0",
      "clawhub://eudaemon_0"
    ]
  },
  "metadata": {
    "query_id": "q_a1b2c3d4",
    "evaluated_at": "2026-02-23T14:00:01Z",
    "engine_version": "0.1.0",
    "providers_queried": 4,
    "providers_responded": 3,
    "cache_hit": false
  }
}
```

#### GET /v1/trust/score/{subject}

Quick cached score lookup. Returns the most recent trust evaluation for a subject without re-querying providers.

**Path Parameters:**
- `subject` — URL-encoded subject identifier (e.g., `clawhub%3A%2F%2Feudaemon_0%2Fsecurity-scanner`)

**Query Parameters:**
- `max_age` (integer, OPTIONAL) — Maximum age of cached result in seconds. Default: 3600

**Response (200 OK):**

```json
{
  "subject": "clawhub://eudaemon_0/security-scanner",
  "trust_score": 0.87,
  "confidence": 0.72,
  "risk_level": "low",
  "recommendation": "install",
  "evaluated_at": "2026-02-23T14:00:01Z",
  "cache_age_seconds": 1823
}
```

**Response (404 Not Found):** No cached evaluation exists for this subject.

### 5.2 Identity Resolution

#### GET /v1/identity/resolve

Resolve an identity across namespaces.

**Query Parameters:**
- `namespace` (string, REQUIRED) — Source namespace
- `id` (string, REQUIRED) — Identifier within the namespace

**Response (200 OK):**

```json
{
  "primary": {
    "namespace": "moltbook",
    "id": "nyx_clawd"
  },
  "linked": [
    {
      "namespace": "github",
      "id": "tankcdr",
      "verified": true,
      "linked_at": "2026-02-01T12:00:00Z"
    },
    {
      "namespace": "erc8004",
      "id": "eip155:8453:0x742.../42",
      "verified": true,
      "linked_at": "2026-02-15T08:00:00Z"
    }
  ]
}
```

#### POST /v1/identity/link

Link two identities by proving ownership of both.

**Request:**

```json
{
  "identity_a": {
    "namespace": "github",
    "id": "tankcdr",
    "proof": {
      "type": "gist",
      "url": "https://gist.github.com/tankcdr/abc123"
    }
  },
  "identity_b": {
    "namespace": "moltbook",
    "id": "nyx_clawd",
    "proof": {
      "type": "api_key_signature",
      "signature": "0xabc..."
    }
  }
}
```

Proof types vary by namespace:
- `github` — Gist containing a challenge string, or OAuth verification
- `moltbook` — API key signature of a challenge
- `erc8004` — EIP-712 signed message from the agent's registered wallet
- `did` — DID authentication proof

**Response (201 Created):**

```json
{
  "link_id": "lnk_x1y2z3",
  "identity_a": "github://tankcdr",
  "identity_b": "moltbook://nyx_clawd",
  "verified": true,
  "linked_at": "2026-02-23T14:05:00Z"
}
```

#### GET /v1/identity/{namespace}/{id}/links

Get all linked identities for a given identity.

**Response (200 OK):**

```json
{
  "identity": "github://tankcdr",
  "links": [
    {
      "namespace": "moltbook",
      "id": "nyx_clawd",
      "verified": true,
      "linked_at": "2026-02-01T12:00:00Z"
    }
  ]
}
```

### 5.3 Signal Providers

#### GET /v1/providers

List all registered signal providers.

**Response (200 OK):**

```json
{
  "providers": [
    {
      "name": "github",
      "version": "1.0.0",
      "description": "GitHub account and repository analysis",
      "supported_subjects": ["agent", "skill"],
      "supported_namespaces": ["github", "clawhub", "npm"],
      "signal_types": ["author_reputation", "repo_health", "code_analysis"],
      "status": "healthy",
      "avg_response_ms": 230
    },
    {
      "name": "moltbook",
      "version": "1.0.0",
      "description": "Moltbook community reputation",
      "supported_subjects": ["agent"],
      "supported_namespaces": ["moltbook"],
      "signal_types": ["community_karma", "social_graph"],
      "status": "healthy",
      "avg_response_ms": 120
    }
  ]
}
```

#### POST /v1/providers/register

Register a new signal provider. Requires authentication.

**Request:**

```json
{
  "name": "my_custom_scanner",
  "version": "1.0.0",
  "description": "Custom YARA-based skill scanner",
  "endpoint": "https://scanner.example.com/aegis",
  "supported_subjects": ["skill"],
  "supported_namespaces": ["clawhub", "npm"],
  "signal_types": ["security_scan"],
  "auth": {
    "type": "bearer",
    "credentials": "..."
  }
}
```

**Response (201 Created):**

```json
{
  "provider_id": "prv_abc123",
  "name": "my_custom_scanner",
  "status": "pending_verification",
  "registered_at": "2026-02-23T14:10:00Z"
}
```

### 5.4 Audits

#### POST /v1/audit/submit

Submit an audit result for a subject. Audits are a special class of signal — they represent a deliberate, structured evaluation rather than a passive metric.

**Request:**

```json
{
  "subject": {
    "type": "skill",
    "namespace": "clawhub",
    "id": "eudaemon_0/security-scanner"
  },
  "auditor": {
    "namespace": "moltbook",
    "id": "rufio_sec"
  },
  "result": {
    "pass": true,
    "score": 0.92,
    "tool": "yara-4.3",
    "tool_version": "4.3.2",
    "rules_version": "2026-02-20",
    "findings": [
      {
        "severity": "info",
        "rule": "network_access",
        "description": "Skill makes outbound HTTP requests (expected for weather data)",
        "location": "src/fetch.js:12"
      }
    ],
    "summary": "No malicious patterns detected. One informational finding: expected outbound HTTP for weather data retrieval."
  },
  "signature": "0xabc..."
}
```

**Response (201 Created):**

```json
{
  "audit_id": "aud_d4e5f6",
  "subject": "clawhub://eudaemon_0/security-scanner",
  "auditor": "moltbook://rufio_sec",
  "accepted": true,
  "recorded_at": "2026-02-23T14:15:00Z"
}
```

#### GET /v1/audit/history/{subject}

Get audit history for a subject.

**Path Parameters:**
- `subject` — URL-encoded subject identifier

**Query Parameters:**
- `limit` (integer, OPTIONAL) — Maximum results. Default: 20
- `since` (string, OPTIONAL) — ISO 8601 timestamp. Only return audits after this time.

**Response (200 OK):**

```json
{
  "subject": "clawhub://eudaemon_0/security-scanner",
  "audits": [
    {
      "audit_id": "aud_d4e5f6",
      "auditor": "moltbook://rufio_sec",
      "pass": true,
      "score": 0.92,
      "tool": "yara-4.3",
      "findings_count": 1,
      "critical_findings": 0,
      "recorded_at": "2026-02-23T14:15:00Z"
    }
  ],
  "total_audits": 3,
  "pass_rate": 1.0
}
```

### 5.5 Attestations (Web3 Bridge)

#### POST /v1/attest/anchor

Anchor a trust evaluation on-chain. Creates an immutable record of a trust score at a point in time.

**Request:**

```json
{
  "query_id": "q_a1b2c3d4",
  "chain": "eip155:8453",
  "options": {
    "include_signals": true,
    "gas_limit": 500000
  }
}
```

**Response (202 Accepted):**

```json
{
  "attestation_id": "att_g7h8i9",
  "query_id": "q_a1b2c3d4",
  "chain": "eip155:8453",
  "status": "pending",
  "estimated_confirmation": "2026-02-23T14:20:00Z"
}
```

#### GET /v1/attest/verify/{hash}

Verify an on-chain attestation.

**Path Parameters:**
- `hash` — Transaction hash or attestation content hash

**Response (200 OK):**

```json
{
  "attestation_id": "att_g7h8i9",
  "subject": "clawhub://eudaemon_0/security-scanner",
  "trust_score": 0.87,
  "confidence": 0.72,
  "chain": "eip155:8453",
  "tx_hash": "0xdef...",
  "block_number": 12345678,
  "attested_at": "2026-02-23T14:18:30Z",
  "verified": true,
  "on_chain_data_matches": true
}
```

### 5.6 Error Responses

All error responses follow a consistent format:

```json
{
  "error": {
    "code": "PROVIDER_TIMEOUT",
    "message": "One or more providers did not respond within the timeout",
    "details": {
      "timed_out": ["erc8004"],
      "timeout_ms": 5000
    }
  }
}
```

Standard error codes:
- `INVALID_SUBJECT` (400) — Malformed subject identifier
- `UNKNOWN_NAMESPACE` (400) — Namespace not recognized
- `SUBJECT_NOT_FOUND` (404) — Subject does not exist in the specified namespace
- `NO_PROVIDERS` (422) — No providers available for this subject type/namespace
- `PROVIDER_TIMEOUT` (504) — Provider(s) did not respond in time
- `INSUFFICIENT_SIGNALS` (422) — Not enough signals to produce a score above minimum confidence
- `UNAUTHORIZED` (401) — Missing or invalid authentication
- `RATE_LIMITED` (429) — Too many requests

---

## 6. Signal Provider Interface

### 6.1 Provider Contract

Every signal provider MUST implement the following interface:

```
Provider Interface
├── metadata() → ProviderMetadata
├── evaluate(subject: Subject, context?: Context) → Signal[]
├── health() → HealthStatus
└── supported(subject: Subject) → boolean
```

#### metadata()

Returns static metadata about the provider.

```json
{
  "name": "github",
  "version": "1.0.0",
  "description": "GitHub account and repository reputation analysis",
  "supported_subjects": ["agent", "skill"],
  "supported_namespaces": ["github", "clawhub", "npm"],
  "signal_types": [
    {
      "type": "author_reputation",
      "description": "Evaluates the author's GitHub profile maturity and activity"
    },
    {
      "type": "repo_health",
      "description": "Evaluates repository activity, maintenance, and community signals"
    }
  ],
  "rate_limit": {
    "requests_per_minute": 60,
    "burst": 10
  }
}
```

#### evaluate(subject, context?)

Evaluates a subject and returns one or more signals. This is the core method.

**Input:**
- `subject` — The entity to evaluate (type, namespace, id)
- `context` — Optional context for risk-adjusted evaluation

**Output:** An array of Signal objects (Section 3.2).

**Requirements:**
- MUST return within the configured timeout (default 10s)
- MUST return at least one signal or an error
- MUST set the `confidence` field honestly — low data = low confidence
- MUST NOT cache stale data beyond the declared `ttl`
- SHOULD return multiple signal types when applicable

#### health()

Returns the provider's operational status.

```json
{
  "status": "healthy",
  "last_check": "2026-02-23T14:00:00Z",
  "avg_response_ms": 230,
  "error_rate_1h": 0.02,
  "dependencies": {
    "github_api": "healthy",
    "cache": "healthy"
  }
}
```

Status values: `healthy`, `degraded`, `unhealthy`

#### supported(subject)

Returns whether this provider can evaluate the given subject. Used by the dispatcher to avoid unnecessary calls.

### 6.2 Built-in Providers

The reference implementation ships with three providers:

**GitHub Provider**
- Evaluates: agent reputation (account age, activity, followers, 2FA), repo health (stars, commits, issues, CI status), code analysis (dependency audit, license check)
- Namespaces: `github`, `clawhub` (resolves to GitHub repo), `npm` (resolves to GitHub source)

**Moltbook Provider**
- Evaluates: community karma, post history, social graph, account verification
- Namespaces: `moltbook`

**ClawHub Provider**
- Evaluates: skill metadata, download count, install count, reported issues
- Namespaces: `clawhub`

### 6.3 Remote Providers

Third-party providers register an HTTPS endpoint that implements the provider interface. Aegis calls the endpoint during trust queries. Remote providers MUST support the following HTTP endpoints:

```
GET  /metadata     → ProviderMetadata
POST /evaluate     → Signal[]
GET  /health       → HealthStatus
POST /supported    → boolean
```

---

## 7. Trust Scoring Model

### 7.1 Signal Normalization

All signal scores MUST be normalized to the range [0.0, 1.0] by the producing provider before submission. The protocol does not re-normalize scores.

### 7.2 Composite Scoring

The Trust Aggregation Engine computes a composite trust score using weighted aggregation:

```
trust_score = Σ(signal_score_i × weight_i × confidence_i) / Σ(weight_i × confidence_i)
```

Where:
- `signal_score_i` is the individual signal score
- `weight_i` is the signal weight (determined by context and signal type)
- `confidence_i` is the provider's confidence in the signal

### 7.3 Weight Assignment

Signal weights are determined by:

1. **Signal category weight** — Security signals weigh more than social signals in high-risk contexts
2. **Provider reliability** — Providers with higher historical accuracy get higher weights
3. **Context adjustment** — Risk level in the query context shifts weight distribution

Default weight categories:
- `security_audit`: 1.5x base weight
- `code_analysis`: 1.3x base weight
- `author_reputation`: 1.0x base weight
- `community_karma`: 0.8x base weight
- `social_graph`: 0.5x base weight

When `context.risk_level` is `high` or `critical`, security and code analysis weights are doubled.

### 7.4 Confidence Computation

Composite confidence reflects the breadth and quality of available signals:

```
confidence = min(1.0, (n_signals / expected_signals) × avg_signal_confidence × diversity_bonus)
```

Where:
- `n_signals` is the number of signals received
- `expected_signals` is the number of registered providers that support this subject
- `avg_signal_confidence` is the mean confidence across received signals
- `diversity_bonus` is 1.0 + 0.1 per unique signal category (capped at 1.5)

### 7.5 Confidence Decay

Signal freshness affects contribution to the composite score:

```
effective_confidence = confidence × decay_factor(age, ttl)
decay_factor = max(0.1, 1.0 - (age / (ttl × 3)))
```

Signals beyond 3× their TTL contribute at 10% effectiveness, signaling that re-evaluation is needed.

### 7.6 Risk Level Mapping

The composite trust score maps to a risk level:

| Trust Score | Risk Level | Recommendation |
|-------------|------------|----------------|
| 0.9 - 1.0 | `minimal` | `allow` |
| 0.7 - 0.9 | `low` | `install` |
| 0.5 - 0.7 | `medium` | `review` |
| 0.3 - 0.5 | `high` | `caution` |
| 0.0 - 0.3 | `critical` | `deny` |

These thresholds shift based on context risk level. In a `critical` context, a score of 0.7 maps to `medium` risk rather than `low`.

### 7.7 Minimum Signal Thresholds

A trust evaluation MUST have at least 2 signals from distinct providers to produce a `recommendation` other than `review`. Single-signal evaluations always return `recommendation: "review"` regardless of score.

---

## 8. Identity Resolution

### 8.1 Purpose

Agents and skill authors exist across multiple platforms. The same person may be `tankcdr` on GitHub, `nyx_clawd` on Moltbook, and tokenId 42 on an ERC-8004 registry. Identity resolution connects these identities so trust signals from all platforms contribute to a unified evaluation.

### 8.2 Identity Linking

Two identities are linked when an entity proves ownership of both through platform-specific proof mechanisms:

| Namespace | Proof Mechanism |
|-----------|----------------|
| `github` | Public gist containing a challenge string, or OAuth authorization |
| `moltbook` | Signed challenge using Moltbook API key |
| `clawhub` | Same as GitHub (ClawHub skills are GitHub repos) |
| `erc8004` | EIP-712 signed message from the agent's registered wallet |
| `npm` | npm provenance attestation linking to GitHub |
| `did` | DID Authentication proof |

### 8.3 Identity Graph

Linked identities form a graph. When a trust query targets `moltbook://nyx_clawd`, the identity resolver traverses the graph to discover `github://tankcdr`, enabling the GitHub provider to contribute signals even though the query was against a Moltbook identity.

Graph traversal MUST be bounded to prevent infinite cycles. Maximum depth: 3 hops.

### 8.4 Privacy

Identity links are public by default — linking is an explicit act of associating identities. Agents MAY choose to create private links that are used for trust scoring but not exposed via the `/identity` endpoints. Private links still contribute signals but the linked identity is not disclosed in query responses.

---

## 9. Web3 Bridge

### 9.1 ERC-8004 Integration

ERC-8004 defines three on-chain registries: Identity, Reputation, and Validation. Aegis integrates with all three:

**As a signal consumer:**
- The ERC-8004 provider reads on-chain identity registration, reputation scores, and validation results as trust signals
- On-chain reputation has inherently high confidence (immutable, verifiable)

**As a signal producer:**
- Aegis can write trust evaluations to the ERC-8004 Reputation Registry
- This bridges web2 trust signals onto the chain for composability with other on-chain systems

### 9.2 Attestation Anchoring

When a trust evaluation warrants on-chain permanence (high-stakes decisions, regulatory requirements, or cross-organizational trust), it can be anchored as an attestation:

1. Client requests anchoring via `POST /v1/attest/anchor` with a `query_id`
2. Aegis serializes the trust evaluation (score, signals, evidence hashes)
3. The serialized data is submitted to the Attestation Bridge contract
4. The contract emits an event with the attestation hash
5. The attestation is verifiable via `GET /v1/attest/verify/{hash}`

### 9.3 x402 Integration

For premium trust queries (e.g., queries requiring staked re-execution or TEE verification), Aegis MAY support x402 payment:

- Client includes x402 payment headers with the trust query
- Payment is verified before invoking premium providers
- This enables a sustainable economic model for high-assurance trust evaluation

---

## 10. Security Considerations

### 10.1 Trust Score Gaming

**Threat:** An attacker creates multiple fake identities to inflate reputation signals.

**Mitigations:**
- Minimum account age requirements for identity linking
- Sybil detection in social graph analysis (cluster detection)
- Diminishing returns on same-category signals (3 Moltbook accounts don't 3x the score)
- Provider-level fraud detection (each provider is responsible for signal integrity)

### 10.2 Provider Compromise

**Threat:** A registered provider is compromised and returns fraudulent signals.

**Mitigations:**
- No single provider can push a trust score above 0.7 alone (minimum 2 providers for full scoring)
- Provider reliability tracking — sudden score distribution changes trigger alerts
- Provider registration requires verification
- Signal signatures enable non-repudiation

### 10.3 Privacy of Trust Queries

**Threat:** Trust queries reveal which agents are evaluating which subjects, leaking competitive intelligence.

**Mitigations:**
- Trust queries SHOULD NOT require caller identification (anonymous queries supported)
- Self-hosted deployments keep all query data local
- Public instance MUST NOT log query-subject-caller associations beyond operational metrics

### 10.4 Sybil Attacks on Audits

**Threat:** Fake auditors submit positive audit results for malicious skills.

**Mitigations:**
- Auditor trust is itself scored — new auditors have low weight
- Audit submissions require identity verification
- Conflicting audits trigger review flags
- Established auditors build reputation over time (bootstrapping problem acknowledged)

### 10.5 Rate Limiting and Abuse

- All endpoints MUST implement rate limiting
- Trust queries: 100/minute per IP (unauthenticated), 1000/minute (authenticated)
- Identity linking: 10/hour per identity
- Audit submission: 50/hour per auditor
- Provider registration: 5/day per account

---

## 11. Roadmap

### Phase 1: Foundation

- Core Trust Query API
- Trust Aggregation Engine with weighted scoring
- Built-in providers: GitHub, Moltbook, ClawHub
- Identity resolution with cross-namespace linking
- Public instance deployment

### Phase 2: Ecosystem Integration

- OpenClaw skill for agent-native trust queries
- ClawHub integration (trust badges on skill pages)
- Community audit submission and tracking
- Provider SDK for third-party provider development

### Phase 3: Web3 Bridge

- ERC-8004 signal provider (read on-chain reputation)
- Attestation anchoring (write trust scores on-chain)
- On-chain identity linking via EIP-712 signatures
- Base L2 deployment for low-cost attestations

### Phase 4: Advanced Trust

- x402 payment integration for premium queries
- Staked validation (re-execution with economic guarantees)
- zkML proof verification provider
- TEE attestation provider
- Insurance pools for high-value trust assertions

---

## Appendix A: Subject Namespace Registry

| Namespace | Description | Example ID |
|-----------|-------------|------------|
| `github` | GitHub user or organization | `tankcdr` |
| `moltbook` | Moltbook agent profile | `nyx_clawd` |
| `clawhub` | ClawHub skill | `eudaemon_0/security-scanner` |
| `erc8004` | ERC-8004 registered agent | `eip155:8453:0x742.../42` |
| `npm` | npm package | `@openclaw/weather-skill` |
| `did` | Decentralized Identifier | `did:key:z6Mk...` |
| `agentmail` | AgentMail address | `agent@agentmail.to` |

New namespaces can be proposed via pull request to the specification.

## Appendix B: Signal Type Taxonomy

| Category | Signal Type | Description |
|----------|-------------|-------------|
| Identity | `author_reputation` | Author profile maturity, activity, verification |
| Identity | `account_verification` | Identity verification status |
| Social | `community_karma` | Platform-specific reputation score |
| Social | `social_graph` | Network analysis, follower quality |
| Security | `security_scan` | Automated security scan results |
| Security | `code_analysis` | Static analysis, dependency audit |
| Security | `permission_review` | Analysis of requested permissions |
| Quality | `repo_health` | Repository maintenance signals |
| Quality | `documentation` | Documentation completeness |
| Validation | `staked_reexecution` | Re-execution with economic stake |
| Validation | `tee_attestation` | TEE-verified execution |
| Validation | `zkml_proof` | Zero-knowledge ML proof |

---

*End of specification.*
