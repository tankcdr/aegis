# Aegis Architecture

## System Overview

```
                         ┌──────────────┐
                         │   Clients    │
                         │ Agents, CLIs,│
                         │  Platforms   │
                         └──────┬───────┘
                                │ HTTPS
                         ┌──────▼───────┐
                         │  API Gateway │
                         │ Auth, Rate   │
                         │ Limiting     │
                         └──────┬───────┘
                                │
              ┌─────────────────▼─────────────────────┐
              │          Trust Query API               │
              │                                        │
              │  POST /v1/trust/query                  │
              │  GET  /v1/trust/score/{subject}        │
              │  GET  /v1/identity/resolve             │
              │  POST /v1/identity/link                │
              │  POST /v1/audit/submit                 │
              │  POST /v1/attest/anchor                │
              └────────────────┬──────────────────────┘
                               │
         ┌─────────────────────▼──────────────────────┐
         │          Trust Aggregation Engine            │
         │                                             │
         │  ┌──────────────┐  ┌──────────────────┐    │
         │  │   Identity   │  │  Signal           │    │
         │  │   Resolver   │  │  Dispatcher        │    │
         │  │              │  │                    │    │
         │  │ Namespace    │  │ Fan-out to         │    │
         │  │ resolution,  │  │ providers,         │    │
         │  │ graph walk   │  │ timeout mgmt       │    │
         │  └──────┬───────┘  └────────┬───────────┘    │
         │         │                   │               │
         │  ┌──────▼───────────────────▼───────────┐   │
         │  │         Scoring Engine               │   │
         │  │                                      │   │
         │  │  Weight signals by category/context   │   │
         │  │  Compute composite score             │   │
         │  │  Apply confidence decay              │   │
         │  │  Map to risk level / recommendation  │   │
         │  └──────────────────────────────────────┘   │
         │                                             │
         │  ┌──────────────────────────────────────┐   │
         │  │           Cache Layer                │   │
         │  │  Per-subject, TTL-based              │   │
         │  └──────────────────────────────────────┘   │
         └─────────────────────────────────────────────┘
                               │
         ┌─────────────────────▼──────────────────────┐
         │          Signal Provider Registry           │
         │                                             │
         │  Built-in:          Remote:                 │
         │  ┌────────┐         ┌──────────────────┐    │
         │  │ GitHub │         │ HTTPS endpoint   │    │
         │  │Moltbook│         │ Provider contract│    │
         │  │ClawHub │         │ Auth + TLS       │    │
         │  └────────┘         └──────────────────┘    │
         └─────────────────────────────────────────────┘
                               │
         ┌─────────────────────▼──────────────────────┐
         │          Attestation Bridge                 │
         │                                             │
         │  ERC-8004 Reputation Registry (write)       │
         │  Attestation contract (Base L2)             │
         │  x402 payment verification                  │
         └─────────────────────────────────────────────┘
```

## Component Details

### API Gateway

Handles cross-cutting concerns before requests reach the Trust Query API:

- **Authentication** — API key or JWT for authenticated requests. Anonymous queries supported with lower rate limits.
- **Rate Limiting** — Per-IP and per-key limits. Token bucket algorithm.
- **TLS Termination** — All external traffic over HTTPS.
- **Request Validation** — Schema validation before forwarding.

### Trust Query API

Stateless REST service implementing the endpoints defined in the [specification](SPEC.md). Receives queries, coordinates with the engine, returns results. No business logic in this layer.

### Trust Aggregation Engine

The core of Aegis. Four sub-components:

**Identity Resolver**
- Maintains the identity graph (namespace → identity → links)
- On query: resolves the subject across namespaces to discover linked identities
- Bounded graph traversal (max 3 hops) to prevent cycles
- Result: expanded set of (namespace, id) pairs for the dispatcher

**Signal Dispatcher**
- Takes the expanded identity set from the resolver
- Queries the provider registry for providers supporting each (namespace, subject_type) pair
- Fans out evaluation requests to providers in parallel
- Enforces per-query timeout (default 10s)
- Collects signals, marks non-responding providers as "unresolved"

**Scoring Engine**
- Receives collected signals
- Applies weight assignment based on signal category and query context
- Computes composite trust score and confidence
- Applies confidence decay for stale signals
- Maps composite score to risk level and recommendation
- See [SPEC.md Section 7](SPEC.md#7-trust-scoring-model) for formulas

**Cache Layer**
- Caches complete trust evaluations keyed by subject + context hash
- Per-signal TTL respected — cached result expires when its shortest-TTL signal expires
- Serves `GET /v1/trust/score/{subject}` from cache
- Cache is optional and can be disabled for real-time evaluation

### Signal Provider Registry

Maintains the set of available providers (built-in and remote):

- **Built-in providers** run in-process. Ship with the reference implementation.
- **Remote providers** are external HTTPS services implementing the provider interface. Registered via API. Aegis calls them during evaluation.
- Registry tracks provider health (periodic health checks), average response time, and reliability metrics.

### Attestation Bridge

Optional component for web3 integration:

- Serializes trust evaluations for on-chain storage
- Submits attestations to smart contracts (Base L2 for low cost)
- Reads from ERC-8004 registries (Identity, Reputation, Validation)
- Verifies x402 payment headers for premium queries

## Data Flow: Trust Query

```
Client                  API     Engine    Resolver   Dispatcher   Providers    Cache
  │                      │        │          │           │            │          │
  │─── POST /trust/query─▶        │          │           │            │          │
  │                      │──▶     │          │           │            │          │
  │                      │        │──resolve─▶           │            │          │
  │                      │        │          │──graph──▶  │            │          │
  │                      │        │   expanded identities │            │          │
  │                      │        │◀─────────│           │            │          │
  │                      │        │──────────────dispatch─▶            │          │
  │                      │        │          │           │──evaluate──▶           │
  │                      │        │          │           │  (parallel) │          │
  │                      │        │          │           │◀──signals───│          │
  │                      │        │◀─────────────────────│            │          │
  │                      │        │──score───▶           │            │          │
  │                      │        │──cache────────────────────────────────▶      │
  │                      │◀──result          │           │            │          │
  │◀──── response ───────│        │          │           │            │          │
```

## Deployment

### Minimum Viable Deployment

```
┌─────────────────────────┐
│  Single Node             │
│                          │
│  API + Engine + Providers│
│  SQLite (identity graph) │
│  In-memory cache         │
└─────────────────────────┘
```

Suitable for self-hosted, low-traffic deployments. Single binary or container.

### Production Deployment

```
┌──────────┐    ┌──────────────┐    ┌───────────┐
│ Load     │    │ API +        │    │ Provider  │
│ Balancer │───▶│ Engine       │───▶│ Workers   │
│          │    │ (stateless)  │    │           │
└──────────┘    └──────┬───────┘    └───────────┘
                       │
                ┌──────▼───────┐
                │ PostgreSQL   │
                │ (identities, │
                │  audits,     │
                │  provider    │
                │  registry)   │
                └──────────────┘
                       │
                ┌──────▼───────┐
                │ Redis        │
                │ (cache,      │
                │  rate limits)│
                └──────────────┘
```

### Embedded Deployment

For platforms integrating Aegis as a library:

```javascript
import { AegisEngine } from '@aegis-protocol/core';

const engine = new AegisEngine({
  providers: ['github', 'moltbook'],
  cache: 'memory',
  scoring: { /* custom weights */ }
});

const result = await engine.query({
  subject: { type: 'skill', namespace: 'clawhub', id: 'author/skill' },
  context: { action: 'install', risk_level: 'high' }
});
```

## Technology Choices (Reference Implementation)

| Component | Technology | Rationale |
|-----------|-----------|-----------|
| API | Node.js / TypeScript | Ecosystem alignment (OpenClaw is Node) |
| Database | PostgreSQL | Relational data (identity graph, audits) |
| Cache | Redis | Fast TTL-based caching, rate limiting |
| Contracts | Solidity | ERC-8004 compatibility |
| Chain | Base L2 | Low cost, Coinbase ecosystem alignment |
