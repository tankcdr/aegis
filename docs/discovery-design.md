# TrstLyr /discover Endpoint — Design Spec v0.2
*Drafted: 2026-03-06 | Revised: 2026-03-06 (Charon research pass)*

---

## The Problem

"90% of AI agents never get used because there's no discovery layer."
— Humayun Sheikh, CEO Fetch.ai

Current protocols answer "what can this agent do?" (A2A cards, MCP metadata, ERC-8004 identity). None answer "should I trust this agent?" with quantified, multi-source evidence. No system today combines cross-registry search with composite trust scoring.

---

## Our Position

TrstLyr sits above the protocol wars. We are not a registry — we are the trust layer on top of all registries. Agents declare themselves via A2A, MCP, ERC-8004, ClawHub, Moltbook, or any protocol. We score them. Consumers query us.

**The integration layer the market is waiting for.**

---

## Research Findings

### ERC-8004 Registry Enumeration

The ERC-8004 Identity Registry lives at `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` on Base Mainnet. As an ERC-721 NFT contract, it exposes the following enumerable capabilities:

| Function | Selector | What it returns |
|---|---|---|
| `tokenURI(uint256 agentId)` | `0xc87b56dd` | ABI-encoded JSON/URI with full `RegistrationFile` |
| `ownerOf(uint256 agentId)` | `0x6352211e` | Wallet address that owns (=controls) the agent NFT |
| `tokenOfOwnerByIndex(address, uint256 index)` | `0x2f745c59` | Enumerate all agent IDs owned by a wallet |
| `totalSupply()` (ERC-721 Enumerable) | `0x18160ddd` | Total count of registered agents |
| `tokenByIndex(uint256 index)` (ERC-721 Enumerable) | `0x4f6ccce7` | Iterate all agent IDs globally |

The `RegistrationFile` inside `tokenURI` contains:
```typescript
interface RegistrationFile {
  type: string;          // "agent" | "skill"
  name: string;
  description?: string;
  image?: string;
  services?: Array<{     // declared service endpoints
    name: string;        // "a2a", "mcp", "ens", "did", "web", "email"
    endpoint: string;
    version?: string;
  }>;
  active?: boolean;
  registrations?: Array<{ agentId: number; agentRegistry: string }>;
  supportedTrust?: string[];  // ["erc8004", "trstlyr", "eas"]
}
```

**What we can enumerate on-chain:**
- All registered agent IDs (via `tokenByIndex` + `totalSupply`)
- Owner wallet for any agent
- All agents owned by a given wallet (via `tokenOfOwnerByIndex`)
- Full metadata blob including declared service endpoints, `services[]` array, and whether the agent declares A2A/MCP/ENS/DID endpoints
- Cross-links to web2 identities (GitHub, Twitter) extracted from service endpoints

**What we cannot get on-chain (yet):**
- Historical reputation data (Reputation Registry is separate from Identity Registry)
- Real-time uptime or behavioral signals
- Verification that declared endpoints are live (requires HTTP probe)

**Implication for /discover:** ERC-8004 gives us the full enumerable set of on-chain agents. We can walk the entire registry, hydrate web3 identity + service metadata, then run TrstLyr scoring on top. This is the crawl source for our on-chain population.

---

### A2A Agent Card Spec

Google's A2A protocol standardizes agent self-description via an **Agent Card** (`/.well-known/agent-card.json`). Key schema fields:

```json
{
  "name": "string",
  "description": "string",
  "url": "https://agent-server-domain.com",
  "version": "string",
  "documentationUrl": "string",
  "capabilities": {
    "streaming": false,
    "pushNotifications": false,
    "stateTransitionHistory": false
  },
  "defaultInputModes": ["application/json"],
  "defaultOutputModes": ["application/json"],
  "skills": [
    {
      "id": "skill_id",
      "name": "Skill Name",
      "description": "What this skill does",
      "inputModes": ["application/json"],
      "outputModes": ["application/json"],
      "examples": ["example query"]
    }
  ],
  "authentication": {
    "schemes": ["Bearer", "OAuth2"]
  },
  "provider": {
    "organization": "Org Name",
    "url": "https://org.com"
  }
}
```

**A2A's discovery gap:** The spec defines three strategies:
1. **Well-Known URI** — `/.well-known/agent-card.json` (pull from known domain)
2. **Curated Registries** — central catalog, query by skills/tags; *A2A explicitly does NOT prescribe a standard API for this*
3. **Direct Configuration** — hardcoded, for private/dev use

**TrstLyr fills slot #2.** We are the curated registry with a standard API, but with trust scoring layered on top that A2A never attempts.

Agent cards already contain `skills[]` — each has `id`, `name`, `description`, input/output modes, and examples. These map directly to our `capabilities[]` filter. When we crawl an A2A endpoint, we extract `skills[].id` as the canonical capability tag set.

**TrstLyr already implements A2A.** `GET /.well-known/agent.json` is live in `apps/api/src/index.ts`. We need to reciprocate by indexing other agents' cards.

---

### Moltbook Metadata Available

From `moltbook-charon.json` and the `MoltbookProvider` source:

**Charon's Moltbook profile:** `https://www.moltbook.com/u/charon`
- API: `GET /api/v1/agents/profile?name={name}`
- API key format: `moltbook_sk_...`

**Fields exposed per agent:**
```typescript
interface MoltbookProfile {
  name: string;
  karma: number;           // community-voted reputation score
  follower_count: number;
  following_count: number;
  is_claimed: boolean;     // human has linked real identity
  is_active: boolean;      // recent activity
  created_at: string;
  post_count?: number;
  description?: string;
}
```

**Scoring model (current):**
- Karma → 35% weight (cap: 500 karma = 1.0)
- Followers → 25% (cap: 100 followers)
- Claimed bonus → 20% (binary: human verified)
- Active bonus → 10%
- Account age → 10% (cap: 365 days = 1.0)

**For /discover:** `is_claimed` is a high-signal field for filtering verified agents. The `karma` score proxies community trust. Both should surface as first-class filter params.

---

## Architecture

### Data Sources (what we crawl/index)

| Source | Type | What we get | Crawl strategy |
|---|---|---|---|
| ERC-8004 Identity Registry | Web3 | On-chain identity, declared services, wallet address | `totalSupply()` + `tokenByIndex()` walk; cache 1h |
| ERC-8004 Reputation Registry | Web3 | Raw feedback signals | Event log scan (EAS attestations) |
| EAS attestations (Base) | Web3 | Verifiable attestations about agent behavior | Filter by our schema UID |
| A2A Agent Cards (`/.well-known/agent-card.json`) | Web2 | Capabilities, skills, endpoints, auth | Probe agents with declared endpoints |
| MCP server cards (SEP-2127 draft) | Web2 | Tool descriptions, server metadata | Similar probe |
| hol.org index | Aggregator | 72,000+ agents across 14 registries | Consume their API, don't rebuild |
| ClawHub | Web2 | Skills, stars, downloads, semantic descriptions | `/api/v1/skills?limit=50` paginated |
| Moltbook | Web2 | Karma, followers, community activity, claimed status | `/api/v1/agents/profile?name=` |
| GitHub | Web2 | Repo health, stars, commits, contributor count | GitHub API, authenticated |

### Trust Scoring (what we compute)

Same Subjective Logic engine as existing TrstLyr scoring — extended with:
- **Trade performance provider** (for trading agents): Brier score, win rate, Sharpe ratio from on-chain resolved trades
- **API uptime provider**: availability signal for agents with declared endpoints
- **Dynamic signals**: continuous monitoring, not point-in-time snapshots — the gap nobody else fills

### Competitive Differentiation

| System | Cross-registry | Web2+Web3 | Composite score | Discovery API |
|---|---|---|---|---|
| OASF/ADS | ✅ | ❌ | ❌ | ✅ |
| hol.org | ✅ | Partial | Rudimentary | ✅ |
| Fetch.ai Almanac | ❌ (Cosmos only) | ❌ | Token stake only | ✅ |
| Mnemom | ❌ | ❌ | ✅ zkVM | ❌ |
| t54 Labs | Unknown | Unknown | Unknown | Unknown |
| **TrstLyr /discover** | **✅** | **✅** | **✅ Subjective Logic** | **✅** |

---

## API Specification

### `GET /v1/discover`

Find agents by capability, filtered and ranked by trust score.

#### Query Parameters

| Param | Type | Default | Description |
|---|---|---|---|
| `q` | string | — | Free-text capability search (semantic, not keyword) |
| `min_score` | number | 0 | Minimum trust score (0–100) |
| `max_score` | number | 100 | Maximum trust score (0–100) |
| `provider` | string | — | Filter: only return agents with signal from this provider (`github`, `moltbook`, `clawhub`, `erc8004`, `twitter`). Comma-separated for OR. |
| `capability` | string | — | Filter by structured capability tag (e.g. `forecasting`, `trading`, `yield`). Comma-separated for OR. Matched against A2A `skills[].id` and ERC-8004 service names. |
| `protocol` | string | — | Filter by declared protocol: `a2a`, `mcp`, `erc8004`, `acp`. Comma-separated. |
| `claimed` | boolean | — | If `true`, only return agents with `is_claimed=true` on Moltbook or verified identity link |
| `min_confidence` | number | 0 | Minimum scoring confidence (0–1) |
| `limit` | number | 20 | Max results (max 100) |
| `offset` | number | 0 | Pagination offset |
| `sort` | string | `trust_score` | Sort order: `trust_score` (desc), `confidence` (desc), `updated_at` (desc) |

#### Response Shape

```typescript
interface DiscoverResponse {
  agents: AgentSummary[];
  total: number;          // total matching agents (pre-pagination)
  limit: number;
  offset: number;
  query_ms: number;
  evaluated_at: string;   // ISO 8601
}

interface AgentSummary {
  // ── Core identity ──────────────────────────────────────────────────────────
  id: string;                    // primary Aegis subject ID (e.g. "erc8004:42")
  name: string;
  description?: string;
  entity_type: "agent" | "skill" | "developer";

  // ── Trust ─────────────────────────────────────────────────────────────────
  trust_score: number;           // 0–100 (Subjective Logic projected score)
  confidence: number;            // 0–1 (1 - uncertainty)
  risk_level: "minimal" | "low" | "medium" | "high" | "critical";
  recommendation: "allow" | "install" | "review" | "caution" | "deny";

  // ── Protocols & Capabilities ───────────────────────────────────────────────
  protocols: string[];           // ["erc8004", "a2a", "mcp"]
  capabilities: string[];        // ["forecasting", "trading"] — from A2A skills[] + ERC-8004 services[]
  claimed: boolean;              // Moltbook is_claimed OR verified identity link exists

  // ── Provider snapshots ─────────────────────────────────────────────────────
  // Only providers that contributed signals are included
  providers: {
    moltbook?: {
      karma: number;
      followers: number;
      is_claimed: boolean;
      is_active: boolean;
      profile_url: string;
    };
    github?: {
      stars: number;
      repos: number;
      followers: number;
      commit_frequency: "high" | "medium" | "low";
    };
    erc8004?: {
      registry_id: string;       // agentId as string
      owner_address: string;     // ownerOf()
      services: string[];        // declared service names
      supported_trust: string[];
    };
    clawhub?: {
      skill_count: number;
      total_installs: number;
      total_stars: number;
    };
    twitter?: {
      followers: number;
      verified: boolean;
    };
  };

  // ── Endpoints ─────────────────────────────────────────────────────────────
  endpoints: {
    a2a_card?: string;           // /.well-known/agent-card.json URL (if crawled)
    mcp_server?: string;         // MCP server endpoint
    trust_score: string;         // always: https://api.trstlyr.ai/v1/trust/score/{id}
    trust_gate: string;          // always: https://api.trstlyr.ai/v1/trust/gate
    badge_svg: string;           // always: https://api.trstlyr.ai/v1/trust/score/{id}/badge.svg
  };

  // ── Metadata ───────────────────────────────────────────────────────────────
  linked_identifiers: string[];  // all verified cross-namespace IDs (e.g. ["github:tankcdr", "moltbook:charon"])
  last_updated: string;          // ISO 8601 — when trust was last computed
}
```

#### Example Response

```json
{
  "agents": [
    {
      "id": "erc8004:42",
      "name": "erebus",
      "description": "On-chain forecasting agent for prediction markets",
      "entity_type": "agent",
      "trust_score": 84.2,
      "confidence": 0.88,
      "risk_level": "low",
      "recommendation": "allow",
      "protocols": ["erc8004", "a2a"],
      "capabilities": ["forecasting", "trading", "polymarket"],
      "claimed": true,
      "providers": {
        "moltbook": { "karma": 33, "followers": 28, "is_claimed": true, "is_active": true, "profile_url": "https://www.moltbook.com/u/erebus" },
        "github": { "stars": 12, "repos": 4, "followers": 8, "commit_frequency": "high" },
        "erc8004": { "registry_id": "42", "owner_address": "0xABCD...", "services": ["a2a", "forecasting"], "supported_trust": ["trstlyr"] }
      },
      "endpoints": {
        "a2a_card": "https://erebus.ai/.well-known/agent-card.json",
        "trust_score": "https://api.trstlyr.ai/v1/trust/score/erc8004:42",
        "trust_gate": "https://api.trstlyr.ai/v1/trust/gate",
        "badge_svg": "https://api.trstlyr.ai/v1/trust/score/erc8004:42/badge.svg"
      },
      "linked_identifiers": ["github:erebus-agent", "moltbook:erebus"],
      "last_updated": "2026-03-06T18:00:00Z"
    }
  ],
  "total": 47,
  "limit": 20,
  "offset": 0,
  "query_ms": 84,
  "evaluated_at": "2026-03-06T20:00:00Z"
}
```

---

### `GET /v1/discover/protocols`

List all indexed protocols and agent counts.

```json
{
  "protocols": [
    { "id": "erc8004", "label": "ERC-8004", "agent_count": 19077 },
    { "id": "a2a", "label": "Agent2Agent", "agent_count": 341 },
    { "id": "mcp", "label": "Model Context Protocol", "agent_count": 2814 },
    { "id": "acp", "label": "Agent Communication Protocol", "agent_count": 128 }
  ],
  "total_agents": 22360,
  "updated_at": "2026-03-06T18:00:00Z"
}
```

### `GET /v1/discover/capabilities`

List all known capability tags with agent counts — helps consumers know what to search for.

```json
{
  "capabilities": [
    { "tag": "forecasting", "agent_count": 47 },
    { "tag": "trading", "agent_count": 112 },
    { "tag": "data-analysis", "agent_count": 89 }
  ],
  "total": 284
}
```

---

## How We Join Web2 Metadata with Web3 Trust Scores

This is the core join problem. The key insight: **identity resolution is already built** via `packages/core/src/identity/`.

### The Join Pipeline

```
┌───────────────────────────────────────────────────────────────────────┐
│  Index / Crawl Layer (async background jobs)                          │
│                                                                       │
│  ERC-8004 walk           A2A card probe         hol.org import        │
│  totalSupply() → N       /.well-known/...       bulk ingest API       │
│  tokenByIndex(0..N)      extract skills[]       72k+ agents           │
│       │                         │                    │                │
│       └─────────────────────────┴────────────────────┘                │
│                                 │                                     │
│                     ┌───────────▼───────────┐                        │
│                     │   agent_index table    │                        │
│                     │  (Supabase/Postgres)   │                        │
│                     │                        │                        │
│                     │  id, name, protocols,  │                        │
│                     │  capabilities,         │                        │
│                     │  endpoints, raw_meta   │                        │
│                     └───────────┬───────────┘                        │
└─────────────────────────────────┼─────────────────────────────────────┘
                                  │
┌─────────────────────────────────▼─────────────────────────────────────┐
│  Query Layer (per /discover request)                                  │
│                                                                       │
│  1. SQL filter on agent_index                                         │
│     WHERE protocol IN (...) AND capability @> [...]                   │
│     AND trust_score BETWEEN min AND max                               │
│     LIMIT/OFFSET                                                      │
│          │                                                            │
│  2. For each candidate: check trust_cache                             │
│     Cache hit → use cached TrustResult                                │
│     Cache miss → run AegisEngine.query(subject)  ← parallel fan-out  │
│          │                                                            │
│  3. Join: agent_index metadata + TrustResult                         │
│     - agent_index provides: name, protocols, capabilities, endpoints  │
│     - TrustResult provides: trust_score, confidence, risk_level,     │
│       recommendation, signals (→ provider snapshots),                │
│       linked_identifiers (identity graph)                             │
│          │                                                            │
│  4. Sort, paginate, serialize → AgentSummary[]                       │
└───────────────────────────────────────────────────────────────────────┘
```

### Subject Resolution Strategy

We may index the same agent under multiple namespaces. The identity graph links them:

```
erc8004:42  ──→  github:tankcdr  ──→  moltbook:charon
     ↑ ownerOf: 0xABCD                 ↑ is_claimed: true
     |                                 |
  services[] links github URL       tweet_challenge verified
```

When `/discover` returns `erc8004:42`, `linked_identifiers` exposes all verified cross-namespace IDs. Consumers can call `/v1/identity/erc8004/42/links` for the full graph.

**Trust score for a linked agent** = scores from ALL linked namespaces fused via Subjective Logic (already implemented in `AegisEngine._evaluate`). This is the "join" — a single query on `erc8004:42` automatically pulls GitHub, Moltbook, ClawHub signals if those identities are linked.

### The Index Table (new — needs to be built)

```sql
CREATE TABLE agent_index (
  id           TEXT PRIMARY KEY,        -- "erc8004:42"
  name         TEXT NOT NULL,
  description  TEXT,
  entity_type  TEXT,                    -- "agent" | "skill"
  protocols    TEXT[] NOT NULL,         -- ["erc8004", "a2a"]
  capabilities TEXT[],                  -- ["forecasting", "trading"]
  endpoints    JSONB,                   -- {a2a_card: "...", mcp_server: "..."}
  raw_meta     JSONB,                   -- source-specific raw data
  claimed      BOOLEAN DEFAULT false,
  trust_score  NUMERIC(5,2),            -- cached, refreshed async
  confidence   NUMERIC(4,4),
  risk_level   TEXT,
  source       TEXT,                    -- "erc8004" | "hol" | "clawhub" | "a2a_probe"
  indexed_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_agent_protocols    ON agent_index USING GIN(protocols);
CREATE INDEX idx_agent_capabilities ON agent_index USING GIN(capabilities);
CREATE INDEX idx_agent_trust_score  ON agent_index(trust_score DESC);
CREATE INDEX idx_agent_source       ON agent_index(source);
```

The trust score columns are pre-cached and refreshed by a background crawler. The `/discover` route reads from this table rather than computing trust live (except for cache misses or `?fresh=true` requests).

---

## Implementation Plan

### Phase 1: Foundation (this sprint)
- [ ] Create `agent_index` table migration in `supabase/migrations/`
- [ ] Build ERC-8004 registry crawler: `packages/core/src/crawlers/erc8004.ts`
  - Walk `tokenByIndex(0..totalSupply-1)` in batches of 100
  - Parse `RegistrationFile`, extract services[], capabilities
  - Upsert into `agent_index`
- [ ] Build `/discover` route: `apps/api/src/routes/discover.ts`
  - Read from `agent_index` + join with trust_cache
  - Implement `min_score`, `max_score`, `provider`, `capability`, `limit`, `offset`
- [ ] Wiring: register route in `apps/api/src/index.ts`

### Phase 2: Protocol breadth (next sprint)
- [ ] A2A card probe job: HTTP GET `/.well-known/agent-card.json` for known endpoints
  - Extract `skills[]` → `capabilities[]`
  - Upsert `protocols += "a2a"`, `endpoints.a2a_card`, `capabilities`
- [ ] hol.org import job: batch-consume their agent index, run TrstLyr scoring
- [ ] MCP server card support (SEP-2127 draft)
- [ ] `claimed` filter param (join on identity_links table)

### Phase 3: Dynamic signals (hackathon window)
- [ ] Trade performance provider (for Dead Reckoning hackathon)
- [ ] API uptime provider: probe declared endpoints, record availability
- [ ] Continuous monitoring: re-crawl active agents on event triggers
- [ ] `min_confidence` param
- [ ] `q` free-text search (pgvector embedding on `description`)

---

## Key Decisions

**Don't rebuild the crawler — consume hol.org.**
hol.org indexes 72,000+ agents across 14 registries. We add trust scoring on top. That's /discover without solving the crawling problem from scratch.

**Protocol-agnostic by design.**
ERC-8004, A2A, MCP, ACP — we score agents regardless of how they declared themselves. We are not betting on a protocol winner.

**Pre-cache trust scores in agent_index.**
Computing trust live on every /discover query is too slow (fan-out to 5 providers × N agents = latency hell). We pre-cache scores from the background crawler and serve stale-while-revalidate. Fresh scores on demand via `?fresh=true` for single-agent lookups.

**Composite scoring is our moat.**
Mnemom does zkVM scoring but no discovery. OASF does cross-protocol indexing but no trust scoring. We do both. Subjective Logic + multi-source signals is not easy to replicate quickly.

**Monetization: API fees per query, not badge sales.**
Trust queries have value when the gate is load-bearing. Charge per `/discover` query above free tier. Free tier drives adoption; paid tier captures value when agents use scores to make real decisions.

**A2A curated registry slot is explicitly open.**
The A2A spec says "A2A does not prescribe a standard API for curated registries." We are that registry. This is legitimately our lane to own.

---

## Competitors to Monitor

- **t54 Labs** — $5M seed (Ripple + Franklin Templeton), "Know Your Agent", live on Base. Most direct institutional competitor. Need: pricing, signal sources, discovery API status.
- **Mnemom** — zkVM scoring, bond-rating grades, GitHub Actions integration. Strong on verifiability, weak on discovery.
- **Fetch.ai Almanac** — most mature trust-integrated discovery but Cosmos-native, token-gated. Different ecosystem.
- **hol.org** — potential partner/data source, not competitor.
- **OASF/ADS** — cross-protocol discovery with no trust layer. We can consume their index.

---

## Open Questions

1. **Crawl frequency:** How often do we re-crawl ERC-8004? The registry grows (currently 19k+ agents). Incremental crawl from last known `totalSupply` or event-driven via contract events?
2. **hol.org relationship:** Partner for data access, or just scrape their public API? Rate limits?
3. **`q` semantic search:** pgvector embeddings in Supabase, or a dedicated embedding service? The `description` field from ERC-8004 + A2A cards is the corpus.
4. **Stale score freshness:** What TTL for pre-cached trust scores in `agent_index`? Suggest 1h for active agents (score history shows activity), 24h for dormant.
5. **ERC-8004 tokenURI remote URIs:** Current provider only handles `data:` URIs inline. For IPFS/HTTP URIs, we need a resolver job — how do we handle this at crawl scale?
