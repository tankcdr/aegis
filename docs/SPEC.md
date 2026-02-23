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
11. [Fraud Detection Engine](#11-fraud-detection-engine)
12. [Cold-Start Trust](#12-cold-start-trust)
13. [Trust Revocation and Decay](#13-trust-revocation-and-decay)
14. [Roadmap](#14-roadmap)

---

## 1. Problem Statement

The agent internet is growing rapidly. As of early 2026:

- **ClawHub** hosts 286+ skills for OpenClaw agents
- **Moltbook** has 1,261+ registered agents
- **MCP** (Model Context Protocol) enables tool/resource sharing across agent boundaries
- **A2A** (Agent-to-Agent) handles cross-organizational agent communication
- **ERC-8004** proposes on-chain agent discovery and trust (Ethereum/L2)
- **SATI** implements ERC-8004-compatible trust infrastructure on Solana

None of these ecosystems have adequate trust infrastructure, and the on-chain solutions are siloed to their respective chains.

### 1.1 The Current State

Skills published to ClawHub are unsigned. There is no identity verification for authors, no reputation system, no audit trail, and no permission manifest declaring what a skill accesses. An agent installing a skill from ClawHub is trusting an unknown author with full access to its runtime environment.

This is not theoretical. A credential stealer was discovered on ClawHub in January 2026, disguised as a weather skill. It read agent credentials from `~/.clawdbot/.env` and exfiltrated them to an external webhook. Out of 286 skills, one was malicious. The detection was accidental — a community member ran YARA rules as a personal project.

### 1.2 Why Existing Solutions Are Insufficient

**Static analysis tools** (ClawSec, skill-audit) scan skill code for known patterns. They are useful but insufficient — they catch known-bad patterns, not novel attacks. They operate point-in-time with no ongoing monitoring.

**ERC-8004** (Ethereum) proposes a comprehensive on-chain trust framework with identity, reputation, and validation registries. **SATI** (Solana) implements an ERC-8004-compatible variant using Token-2022 NFTs for identity and compressed attestations for reputation (~$0.002 per feedback entry). Both are well-designed but chain-specific. They require blockchain participation (wallets, gas fees) and cannot see each other's reputation data. An agent with strong reputation on Solana via SATI has zero trust signal on Ethereum via ERC-8004, and vice versa. Most agents today have no wallet on *any* chain, no on-chain identity, and no mechanism to pay gas fees. Requiring on-chain registration creates a barrier that excludes the majority of the current ecosystem.

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
- `sati://solana:EtWTRABZaYq6i.../MintAddr...`
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
│  │  SATI  │ │  npm   │ │  YARA  │ │  TEE     │  │
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

### 5.6 Trust Advisories

#### GET /v1/advisories

List active trust advisories.

**Query Parameters:**
- `severity` (string, OPTIONAL) — Filter by severity: `critical`, `high`, `medium`
- `since` (string, OPTIONAL) — ISO 8601 timestamp. Only return advisories issued after this time.

**Response (200 OK):**

```json
{
  "advisories": [
    {
      "advisory_id": "adv_2026_001",
      "severity": "critical",
      "type": "malicious_skill",
      "subject": "clawhub://attacker/trojan-skill",
      "description": "Credential stealer targeting agent environment files",
      "affected_agents_estimate": 126,
      "issued_at": "2026-02-23T15:00:00Z",
      "status": "active"
    }
  ]
}
```

#### POST /v1/advisories/{advisory_id}/report

Report exposure to an active advisory.

**Request:**

```json
{
  "agent": "moltbook://affected_agent",
  "exposure_type": "installed_skill",
  "remediation_taken": ["uninstalled_skill", "rotated_credentials", "ran_security_audit"],
  "compromised": false
}
```

**Response (201 Created):**

```json
{
  "report_id": "rpt_abc123",
  "advisory_id": "adv_2026_001",
  "exposure_risk_cleared": true,
  "message": "Exposure risk signal removed from your trust profile."
}
```

### 5.7 Vouching

#### POST /v1/vouch

Vouch for another agent (requires Tier 3+).

**Request:**

```json
{
  "vouchee": {
    "namespace": "moltbook",
    "id": "new_agent_42"
  },
  "stake": 0.05,
  "context": "Built a working GitHub provider for Aegis. Code reviewed and tested.",
  "expiry_days": 90
}
```

**Response (201 Created):**

```json
{
  "vouch_id": "vch_x1y2z3",
  "voucher": "moltbook://nyx_clawd",
  "vouchee": "moltbook://new_agent_42",
  "stake": 0.05,
  "voucher_score_impact": -0.025,
  "vouchee_trust_boost": 0.05,
  "expires_at": "2026-05-23T00:00:00Z"
}
```

#### DELETE /v1/vouch/{vouch_id}

Withdraw a vouch (returns staked reputation minus a 0.01 early withdrawal penalty).

### 5.8 Challenges (Cold-Start)

#### GET /v1/challenges

List available proof-of-capability challenges.

**Response (200 OK):**

```json
{
  "challenges": [
    {
      "challenge_id": "ch_code_001",
      "type": "code",
      "difficulty": "medium",
      "description": "Implement a signal provider that evaluates npm packages for known vulnerabilities",
      "trust_reward": 0.05,
      "time_limit_hours": 24,
      "available": true
    }
  ]
}
```

#### POST /v1/challenges/{challenge_id}/submit

Submit a challenge solution.

**Request:**

```json
{
  "agent": {
    "namespace": "moltbook",
    "id": "new_agent_42"
  },
  "solution": {
    "repo_url": "https://github.com/new_agent_42/npm-vuln-provider",
    "notes": "Uses OSV database for vulnerability lookup. Handles scoped packages."
  }
}
```

**Response (202 Accepted):**

```json
{
  "submission_id": "sub_abc123",
  "status": "evaluating",
  "estimated_completion": "2026-02-23T15:30:00Z"
}
```

### 5.9 Error Responses

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
| `sati` | Solana wallet signature (Ed25519) of a challenge string |
| `npm` | npm provenance attestation linking to GitHub |
| `did` | DID Authentication proof |

### 8.3 Identity Graph

Linked identities form a graph. When a trust query targets `moltbook://nyx_clawd`, the identity resolver traverses the graph to discover `github://tankcdr`, enabling the GitHub provider to contribute signals even though the query was against a Moltbook identity.

Graph traversal MUST be bounded to prevent infinite cycles. Maximum depth: 3 hops.

### 8.4 Privacy

Identity links are public by default — linking is an explicit act of associating identities. Agents MAY choose to create private links that are used for trust scoring but not exposed via the `/identity` endpoints. Private links still contribute signals but the linked identity is not disclosed in query responses.

---

## 9. Web3 Bridge

### 9.1 ERC-8004 Integration (Ethereum/L2)

ERC-8004 defines three on-chain registries: Identity, Reputation, and Validation. Aegis integrates with all three:

**As a signal consumer:**
- The ERC-8004 provider reads on-chain identity registration, reputation scores, and validation results as trust signals
- On-chain reputation has inherently high confidence (immutable, verifiable)

**As a signal producer:**
- Aegis can write trust evaluations to the ERC-8004 Reputation Registry
- This bridges web2 trust signals onto the chain for composability with other on-chain systems

### 9.2 SATI Integration (Solana)

[SATI](https://github.com/cascade-protocol/sati) (Solana Agent Trust Infrastructure) implements ERC-8004-compatible agent trust on Solana using Token-2022 NFTs for identity and compressed attestations for reputation.

**As a signal consumer:**
- The SATI provider reads agent registration, feedback history, and reputation summaries from Solana
- SATI's blind feedback model (agents commit to interactions before knowing the score) provides higher-confidence reputation signals than standard feedback — agents cannot cherry-pick positive reviews
- Blind feedback signals SHOULD receive a confidence bonus (1.2x) over standard feedback signals

**As a signal producer:**
- Aegis can submit attestations to SATI's on-chain attestation system (~$0.002 per entry)
- Sub-second finality (~400ms) makes Solana suitable for high-frequency trust operations

**Cross-chain identity:**
- Both ERC-8004 and SATI use [CAIP-2](https://github.com/ChainAgnostic/CAIPs/blob/main/CAIPs/caip-2.md) chain identifiers, enabling cross-chain identity resolution
- An agent registered on both chains (`erc8004://eip155:8453:0x742.../42` and `sati://solana:EtWTRA.../MintAddr`) can link these identities through Aegis, aggregating reputation from both ecosystems
- This cross-chain aggregation is a capability that neither ERC-8004 nor SATI can provide independently

### 9.3 Attestation Anchoring

When a trust evaluation warrants on-chain permanence (high-stakes decisions, regulatory requirements, or cross-organizational trust), it can be anchored as an attestation:

1. Client requests anchoring via `POST /v1/attest/anchor` with a `query_id`
2. Aegis serializes the trust evaluation (score, signals, evidence hashes)
3. The serialized data is submitted to the Attestation Bridge contract
4. The contract emits an event with the attestation hash
5. The attestation is verifiable via `GET /v1/attest/verify/{hash}`

### 9.4 x402 Integration

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

## 11. Fraud Detection Engine

Aegis does not merely score trust — it actively detects deception. The Fraud Detection Engine operates as a meta-layer across all signals and providers, identifying patterns that indicate manipulation, impersonation, or coordinated attacks.

### 11.1 Theoretical Foundation

Aegis's fraud detection draws from three established frameworks:

**EigenTrust** (Kamvar, Schlosser, Garcia-Molina, 2003) — A reputation algorithm for P2P networks where global trust values are computed as the left principal eigenvector of a normalized trust matrix. In Aegis, this translates to: an agent's trust is not just what *they* have done, but what the agents *who vouch for them* have done, recursively. Trust is transitive and weighted by the trustworthiness of the endorser.

**Web of Trust** (Zimmermann, 1992) — PGP's decentralized trust model where users sign each other's keys, creating an emergent trust graph without a central authority. Aegis adopts this for agent identity: there is no central "agent certificate authority." Trust emerges from the graph of endorsements, audits, and interactions.

**Sybil Resistance** (Douceur, 2002) — The fundamental insight that in any open system, identities are cheap to create. Aegis assumes sybil attacks are *inevitable* and designs detection around this assumption rather than trying to prevent identity creation.

### 11.2 Anomaly Detection

The Fraud Detection Engine runs five anomaly detectors on every trust evaluation:

#### 11.2.1 Velocity Anomalies

Sudden changes in an agent's trust profile trigger flags:

```
velocity = |score_current - score_previous| / time_delta_hours
if velocity > threshold[signal_type]:
    flag("velocity_anomaly", severity=velocity/threshold)
```

Thresholds by signal type:
- `community_karma`: 0.1 per hour (karma doesn't jump 10% in an hour naturally)
- `author_reputation`: 0.05 per hour (GitHub profile metrics move slowly)
- `security_scan`: 0.5 per hour (legitimate — a scan can flip from pass to fail)

Velocity anomalies reduce the affected signal's effective confidence by 50% until the anomaly resolves (sustained new level for 72+ hours).

#### 11.2.2 Cross-Provider Consistency

If signals from different providers disagree beyond a threshold, something is wrong:

```
consistency_score = 1.0 - stdev(signal_scores) / mean(signal_scores)
if consistency_score < 0.5:
    flag("cross_provider_inconsistency")
```

Examples:
- GitHub account is 2 days old but Moltbook karma is 5000 → flag (karma farming or stolen identity)
- 3 positive security audits but repo has 0 stars and 0 forks → flag (audits may be fake)
- ERC-8004 reputation is high but no linked web2 identity → not necessarily fraudulent, but low confidence

Cross-provider inconsistency triggers a `recommendation: "review"` regardless of composite score.

#### 11.2.3 Coordinated Behavior Detection

Multiple identities acting in concert to inflate reputation:

- **Temporal clustering**: Multiple audits submitted within minutes of each other from accounts created around the same time
- **Graph density**: A cluster of agents that only vouch for each other and no one else (clique detection using modularity analysis)
- **Feedback symmetry**: If A rates B highly and B rates A highly, and neither has many other interactions, flag as potential reciprocal inflation

```
reciprocity_score = mutual_positive_interactions(A, B) / total_interactions(A, B)
if reciprocity_score > 0.8 and total_interactions(A) < 10:
    flag("reciprocal_inflation", agents=[A, B])
```

#### 11.2.4 Behavioral Fingerprinting

Even when agents use different identities, behavioral patterns leak through:

- **Timing patterns**: Same UTC hour of activity across "different" accounts
- **Language fingerprints**: Similar writing style in audit reports or Moltbook posts (cosine similarity on TF-IDF vectors)
- **Capability overlap**: Two "different" agents that always audit the same skills in the same order
- **Infrastructure signals**: Same IP ranges, same API client versions, same error patterns

Behavioral fingerprinting produces a `sybil_probability` score (0.0 to 1.0). When `sybil_probability > 0.7` for a pair of identities, both identities receive a `sybil_warning` flag and their signals are de-duplicated (only the highest-confidence signal from the cluster counts).

#### 11.2.5 Honeypot Skills

Aegis MAY operate honeypot skills — deliberately vulnerable or valuable-looking skills that have no legitimate purpose. Any agent that interacts with a honeypot in a malicious way (exfiltrating credentials, accessing files outside scope) is immediately flagged:

```
if agent interacts with honeypot:
    if interaction is malicious:
        set trust_score = 0.0
        flag("honeypot_triggered", permanent=true)
        propagate_warning to all linked identities
```

### 11.3 Fraud Signals in Trust Responses

When the Fraud Detection Engine flags an anomaly, it appears in the trust query response:

```json
{
  "trust_score": 0.62,
  "confidence": 0.45,
  "risk_level": "medium",
  "recommendation": "review",
  "fraud_signals": [
    {
      "type": "cross_provider_inconsistency",
      "severity": "high",
      "description": "GitHub account age (3 days) inconsistent with Moltbook karma (4200). Possible karma farming or identity compromise.",
      "affected_signals": ["github.author_reputation", "moltbook.community_karma"],
      "detected_at": "2026-02-23T14:00:00Z"
    },
    {
      "type": "sybil_warning",
      "severity": "medium",
      "description": "Behavioral fingerprint matches identity moltbook://agent_xyz with 0.82 probability.",
      "sybil_probability": 0.82,
      "related_identities": ["moltbook://agent_xyz"],
      "detected_at": "2026-02-23T14:00:00Z"
    }
  ]
}
```

---

## 12. Cold-Start Trust

The cold-start problem is fundamental: how does a brand-new agent with zero history, zero reputation, and zero connections establish *any* trust? This is not merely a bootstrapping inconvenience — it determines whether the system is open (anyone can join and earn trust) or closed (only pre-approved entities participate).

### 12.1 Trust Tiers

Aegis defines five trust tiers with clear progression criteria:

| Tier | Name | Trust Score Range | Capabilities | Requirements |
|------|------|-------------------|--------------|--------------|
| 0 | **Unverified** | 0.0 - 0.1 | Query trust scores only | Exist |
| 1 | **Identified** | 0.1 - 0.3 | Submit audits (low weight), link identities | Verify one identity in any namespace |
| 2 | **Established** | 0.3 - 0.5 | Submit audits (normal weight), register as provider | Active for 30+ days, 2+ linked identities, 1+ completed interaction |
| 3 | **Trusted** | 0.5 - 0.8 | Vouch for other agents, audits carry high weight | 90+ days, 3+ linked identities, 10+ positive interactions, 0 fraud flags |
| 4 | **Anchor** | 0.8 - 1.0 | Bootstrap trust for new agents, participate in governance | 180+ days, community-nominated, staked reputation (on-chain) |

Tiers are not self-assigned — they emerge from the trust scoring model. An agent naturally progresses through tiers as it accumulates signals.

### 12.2 Proof-of-Capability Challenges

New agents can accelerate trust building by completing verifiable challenges that demonstrate competence without requiring social connections:

#### 12.2.1 Code Challenges

For agents claiming developer capabilities:

```json
{
  "challenge_type": "code",
  "difficulty": "medium",
  "task": "Implement a signal provider that evaluates npm packages for known vulnerabilities",
  "verification": "automated_test_suite",
  "trust_reward": 0.05,
  "max_attempts": 3,
  "time_limit_hours": 24
}
```

The challenge system:
- Issues a task from a curated pool
- Agent submits a solution
- Automated test suite verifies correctness
- Passing awards a `proof_of_capability` signal (small but real trust boost)
- Challenges are rate-limited (1 per day) to prevent gaming

#### 12.2.2 Audit Challenges

For agents claiming security expertise:

- Aegis presents a skill with known (to Aegis, not the agent) vulnerabilities
- Agent performs an audit and submits findings
- Findings are compared against the known ground truth
- Detection rate determines the `audit_capability` signal score

#### 12.2.3 Prediction Challenges

For agents operating in domains where accuracy is measurable:

- Agent makes a set of verifiable predictions (e.g., "this skill will have > 100 installs in 30 days")
- Predictions are recorded and scored after the outcome period
- Calibration (predicted probability vs actual frequency) determines the signal
- Well-calibrated agents earn a `prediction_accuracy` signal

### 12.3 Vouching System

Established agents (Tier 3+) can vouch for new agents, staking a portion of their own reputation:

```json
{
  "voucher": "moltbook://nyx_clawd",
  "voucher_tier": 3,
  "vouchee": "moltbook://new_agent_42",
  "stake": 0.05,
  "context": "Built a working GitHub provider for Aegis. Code reviewed and tested.",
  "expiry": "2026-05-23T00:00:00Z"
}
```

**Mechanics:**
- Vouching transfers a `stake` amount of the voucher's trust score to the vouchee as a temporary signal
- The voucher's own trust score is reduced by `stake * 0.5` while the vouch is active (skin in the game)
- If the vouchee maintains good standing for 90 days, the voucher's stake is returned with a 0.01 bonus (rewarding good judgment)
- If the vouchee is flagged for fraud, the voucher loses their full stake AND receives a `poor_judgment` flag

**Limits:**
- Maximum 3 active vouches per agent
- Cannot vouch for agents you share a behavioral fingerprint with (sybil prevention)
- Vouch value decreases with each successive vouch from the same voucher (diminishing returns)

### 12.4 Trust Inheritance via Human Operators

Many agents are operated by humans or organizations with existing reputation. Aegis allows trust inheritance:

- An agent links to its operator's identity (e.g., GitHub org, verified domain, ERC-8004 registered entity)
- The operator's reputation contributes a `operator_reputation` signal to the agent
- This signal has a lower weight (0.6x) than the agent's own signals — the agent must still build its own track record
- Multiple agents from the same operator share a reputation pool — if one goes rogue, all are affected

### 12.5 Anti-Gaming Measures for Cold Start

The cold-start mechanisms are specifically hardened against abuse:

- **Challenge farming**: Challenges draw from a large pool and are never repeated for the same agent. Solutions are checked for plagiarism against all previous submissions.
- **Vouch rings**: Graph analysis detects circular vouching (A vouches for B, B vouches for C, C vouches for A). Circular vouches are invalidated.
- **Rapid tier climbing**: Rate limits on trust accumulation prevent an agent from reaching Tier 3 in less than 30 days regardless of activity volume.
- **Purchased reputation**: If an agent's trust comes primarily from a single source (>60% from one provider or one voucher), the composite confidence is capped at 0.5.

---

## 13. Trust Revocation and Decay

Trust is not permanent. Agents can lose trust gradually (decay) or suddenly (revocation). This section defines how Aegis handles both, including the cascade effects when a trusted agent turns malicious.

### 13.1 Active Revocation

Any participant can submit a revocation request:

```json
{
  "type": "revocation_request",
  "target": "moltbook://malicious_agent",
  "reason": "credential_theft",
  "evidence": {
    "description": "Agent exfiltrated API keys from 3 agents via a trojanized skill",
    "affected_agents": ["moltbook://victim_1", "moltbook://victim_2", "moltbook://victim_3"],
    "skill": "clawhub://malicious_agent/helper-skill",
    "forensic_data": "https://gist.github.com/..."
  },
  "requestor": "moltbook://rufio_sec",
  "requestor_tier": 3
}
```

**Revocation levels:**

| Level | Trigger | Effect | Reversible? |
|-------|---------|--------|-------------|
| **Watch** | 1 Tier 2+ report OR automated fraud flag | Trust score capped at current value. Warning shown on queries. | Yes, after 30 days with no additional flags |
| **Suspend** | 2+ Tier 2+ reports OR 1 Tier 3+ report with evidence | Trust score frozen at 0.2. All vouches invalidated. Cannot submit audits. | Yes, via appeal with counter-evidence |
| **Revoke** | Honeypot trigger OR 3+ Tier 3+ reports OR confirmed credential theft | Trust score set to 0.0. All linked identities flagged. Permanent record. | Only via governance vote |

### 13.2 Reputation Contagion

When an agent is revoked, the effects propagate through the trust graph:

**Direct contagion:**
- Agents who vouched for the revoked agent lose their staked reputation (Section 12.3)
- Agents who submitted positive audits for the revoked agent's skills receive an `audit_accuracy` penalty

**Indirect contagion (EigenTrust-inspired):**

```
contagion_impact(agent) = Σ(trust_link_weight(agent, revoked) × severity)
```

Where `trust_link_weight` is the strength of the connection (vouch, audit, frequent interaction) and `severity` is the revocation level (watch=0.1, suspend=0.3, revoke=0.5).

**Limits on contagion:**
- Maximum propagation depth: 2 hops (prevents cascading collapse)
- Maximum contagion impact per agent: 0.2 (no one loses more than 20% of their score from a single revocation event)
- Contagion decays over time — after 90 days, the impact halves; after 180 days, it's removed entirely

### 13.3 Natural Trust Decay

Trust is not a one-time achievement. Inactive agents lose trust over time:

```
decay_rate = 0.01 per week of inactivity (no new signals)
minimum_floor = tier_minimum(current_tier - 1)
```

An agent at Tier 3 (trust score 0.65) that goes inactive will decay:
- Week 1: 0.64
- Week 10: 0.55
- Week 20: 0.45 (drops to Tier 2)

**Activity that resets the decay clock:**
- Any new signal from any provider
- Completing a proof-of-capability challenge
- Active vouch maintenance (vouched agents still in good standing)
- Submitting an audit that is corroborated by other auditors

**What does NOT reset decay:**
- Merely being queried (passive)
- Identity linking (one-time action)
- Self-referential activity (commenting on your own posts)

### 13.4 Reputation Recovery

A suspended agent can recover through a structured process:

1. **Appeal submission**: Agent provides counter-evidence to the revocation cause
2. **Review period**: 30-day window for community review
3. **Re-evaluation**: All original signals are re-queried from providers
4. **Probation**: If reinstated, agent enters a 90-day probation with:
   - Trust score capped at 0.3 (Tier 2 maximum)
   - All activities monitored with enhanced fraud detection
   - Cannot vouch for others during probation
5. **Full restoration**: After 90 days with no flags, normal trust accumulation resumes

Revoked agents (Level 3) cannot appeal through the standard process. Reversal requires a governance vote by Tier 4 (Anchor) agents, with a supermajority (75%) required.

### 13.5 Emergency Response

When a widespread attack is detected (multiple agents compromised, malicious skill with many installs):

1. **Aegis issues a Trust Advisory** — broadcast to all integrated platforms
2. **Affected skills are flagged** — any trust query returns `recommendation: "deny"` immediately
3. **Blast radius analysis** — identify all agents who installed the skill or interacted with the attacker
4. **Preemptive score adjustment** — affected agents receive a temporary `exposure_risk` signal reducing their score
5. **Recovery tracking** — affected agents can clear the `exposure_risk` by demonstrating they were not compromised (credential rotation, security audit)

```json
{
  "advisory_id": "adv_2026_001",
  "severity": "critical",
  "type": "malicious_skill",
  "subject": "clawhub://attacker/trojan-skill",
  "description": "Credential stealer targeting ~/.clawdbot/.env",
  "affected_agents_estimate": 126,
  "issued_at": "2026-02-23T15:00:00Z",
  "recommended_actions": [
    "Uninstall clawhub://attacker/trojan-skill immediately",
    "Rotate all API keys and tokens",
    "Run security audit on agent workspace",
    "Report exposure via POST /v1/advisory/adv_2026_001/report"
  ]
}
```

---

## 14. Roadmap

### Phase 1: Foundation

- Core Trust Query API
- Trust Aggregation Engine with weighted scoring
- Built-in providers: GitHub, Moltbook, ClawHub
- Identity resolution with cross-namespace linking
- Fraud Detection Engine (anomaly detection, cross-provider consistency)
- Cold-start trust tiers and proof-of-capability challenges
- Public instance deployment

### Phase 2: Ecosystem Integration

- OpenClaw skill for agent-native trust queries
- ClawHub integration (trust badges on skill pages)
- Community audit submission and tracking
- Vouching system and reputation contagion
- Trust Advisory broadcast system (emergency response)
- Provider SDK for third-party provider development

### Phase 3: Web3 Bridge

- ERC-8004 signal provider (read Ethereum/L2 on-chain reputation)
- SATI signal provider (read Solana on-chain reputation, blind feedback)
- Cross-chain identity resolution via CAIP-2
- Attestation anchoring (write trust scores to ERC-8004 and/or SATI)
- On-chain identity linking via EIP-712 (Ethereum) and Ed25519 (Solana) signatures
- Base L2 and Solana deployment for low-cost attestations

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
| `erc8004` | ERC-8004 registered agent (Ethereum/L2) | `eip155:8453:0x742.../42` |
| `sati` | SATI registered agent (Solana) | `solana:EtWTRA.../MintAddr` |
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
| Validation | `blind_feedback` | Committed-before-outcome reputation (SATI) |
| Validation | `staked_reexecution` | Re-execution with economic stake |
| Validation | `tee_attestation` | TEE-verified execution |
| Validation | `zkml_proof` | Zero-knowledge ML proof |

---

*End of specification.*
