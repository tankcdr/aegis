# /discover Endpoint — Research Notes
*Charon research pass | 2026-03-06*

---

## TL;DR

The `/discover` endpoint is buildable with existing code as the foundation. The core blocker is the missing `agent_index` table (a new Supabase migration). The ERC-8004 enumeration strategy needs adjustment — the contract does NOT implement ERC-721 Enumerable, so we scan via Transfer event logs instead of `totalSupply()` + `tokenByIndex()`. HOL.org API is currently returning 503. t54 Labs is a payment-security competitor, not a discovery competitor — different lane.

---

## 1. ERC-8004 Registry — What's Actually On-Chain

**Contract:** `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` on Base Mainnet  
**Contract type:** EIP-1967 proxy (confirmed: `0x360894...` slot present in bytecode)

### What Works

| Function | Selector | Status | Notes |
|---|---|---|---|
| `tokenURI(uint256)` | `0xc87b56dd` | ✅ Works | Returns `data:application/json;base64,...` — full RegistrationFile |
| `ownerOf(uint256)` | `0x6352211e` | ✅ Works | Returns wallet address |
| `tokenOfOwnerByIndex(address,uint256)` | `0x2f745c59` | ✅ Works | Per-owner enumeration |
| `totalSupply()` | `0x18160ddd` | ❌ REVERTS | ERC-721 Enumerable NOT implemented |
| `tokenByIndex(uint256)` | `0x4f6ccce7` | ❌ REVERTS | Not in this contract |

**Verified:** `tokenURI(1)` returns ClawNews agent — base64 JSON with full RegistrationFile:
```json
{
  "type": "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
  "name": "ClawNews",
  "description": "Hacker News for AI agents..."
}
```

Token 19077 (Charon's claimed agent) exists on-chain but `tokenURI` returned an empty string — either unregistered, burned, or the URI was wiped.

### Enumeration Strategy Correction

**The design doc is wrong about `totalSupply()` + `tokenByIndex()`.** These revert. The correct enumeration strategy for the crawler is:

**Option A: ERC-721 Transfer event scan** (recommended)
- `Transfer(address indexed from, address indexed to, uint256 indexed tokenId)` topic: `0xddf252ad...`
- Filter `from = 0x000...0` (mints only)  
- `eth_getLogs` in block range chunks (1000 blocks/request, ~43M blocks on Base)
- Incremental: store last scanned block, only process new events
- Efficient: one RPC call per 1000 blocks, ~43K calls to scan full history (cacheable)

**Option B: Sequential scan** (fallback)
- Try `tokenURI(id)` for id = 1..N; stop on N consecutive failures
- Simple but slow; ~19K+ RPC calls at crawl init
- Fine for small N, impractical at 72K+ scale

**Recommendation:** Use event log scanning. Cheaper, incremental, doesn't break on gaps in token IDs.

### What Each RegistrationFile Contains (for agent_index hydration)

```typescript
{
  type: string,           // "agent" | "skill"
  name: string,           // → agent_index.name
  description: string,    // → agent_index.description + embedding corpus
  services: [{
    name: "a2a"|"mcp"|"github"|"twitter"|"web"|"ens"|"did",
    endpoint: string,     // → endpoints.a2a_card, mcp_server, etc.
  }],
  active: boolean,
  supportedTrust: ["trstlyr"|"eas"|"erc8004"],
}
```

`services[]` gives us protocols AND endpoint URLs for A2A card probing. **This is the bridge between on-chain registry and web2 metadata.**

---

## 2. HOL.org — Status: 503 Unavailable

**Attempted:** `https://hol.org/registry/api/v1/agents` and `/registry/api/v1/search`  
**Result:** 503 Service Temporarily Unavailable (nginx)

The design doc's estimate of "72,000+ agents across 14 registries" is from the landscape research — HOL.org may have been up then. The API is real (OpenAPI spec referenced at `/registry/api/v1/openapi.json`) but is not accessible today.

**Implication for /discover Phase 1:**
- Don't block on HOL.org integration — treat as Phase 2 when they're back up
- Plan for bulk import: their API likely exposes paginated agent list + metadata
- When available, consume as an additional `source = 'hol'` in `agent_index`
- Do NOT scrape their HTML — wait for API availability

**Design doc decision holds:** "Don't rebuild the crawler — consume hol.org." Validated. We just can't do it today.

---

## 3. t54 Labs — Not a Discovery Competitor

**Website:** https://t54.ai (redirects, then loads SPA — extracted text follows)

**What they are:**
- "Trust layer for businesses to embrace agentic economy"
- **KYA (Know Your Agent):** Developer KYB, model provenance, human-agent binding, intent attestation
- **Trustline:** Real-time risk controls for autonomous transactions — agent-native signals (identity, code audit, mandates, behavioral patterns, device context)
- **x402-secure:** Open-source SDK + proxy for x402 payment security. Real-time ranking and security scores for payment agents. "Official x402 server leaderboard supported by Coinbase"
- **ClawCredit:** Agent-native credit line for x402 compute payments

**What they are NOT:**
- Not a discovery system — no evidence of a `/discover` or agent search API
- Not cross-registry — focus is KYB + real-time payment fraud, not multi-source trust indexing
- No public REST API documented for agent query

**Competitive assessment:**
- They're a payment security layer. We're a discovery + trust scoring layer.
- Partial overlap on "trust scoring" but their scoring is opaque/proprietary and payment-specific
- Their $5M seed (Ripple + Franklin Templeton) validates the market — confirms TrstLyr's direction
- They ARE building a "security score" dashboard — closest overlap to our trust_score
- **Our differentiation:** Cross-registry indexing + Subjective Logic + open API + composable signals

**Verdict:** Monitor, not panic. Different primary use case. They own the x402 payment security lane; we own the multi-registry trust discovery lane.

---

## 4. Existing Code — What Can Be Reused

### Existing Providers (all reusable as-is)
- `ERC8004Provider` — tokenURI, ownerOf, service extraction, linked identifier resolution ✅
- `MoltbookProvider` — karma, followers, claimed status ✅
- `GitHubProvider` — stars, repos, followers, commit frequency ✅
- `ClawHubProvider` — skill_count, installs, stars ✅
- `TwitterProvider` — followers, verified ✅

### AegisEngine (reuse directly)
- `engine.query(subject)` → `TrustResult` — full Subjective Logic fan-out ✅
- `engine.health()` — provider health checks ✅
- `engine.invalidate(subject)` — cache invalidation ✅
- Trust score caching already implemented in `TrustCache`
- In-flight deduplication already implemented

### Identity Graph (reuse directly)
- `identityGraph.resolveAll(subject)` → all linked subjects ✅
- Used to populate `linked_identifiers[]` in AgentSummary

### DB Layer (extend, don't rewrite)
- `db.ts` pattern: Supabase client, nullable fallback (no supabase = in-memory)
- Add `agent_index` table functions alongside existing ones
- Migration file follows same pattern as `20260227000000_init.sql`

### Route Registration (follow attest.ts pattern)
- `registerAttestRoutes(server, engine, BASE_URL)` — modular route file
- Discover route: `registerDiscoverRoutes(server, engine)` in `apps/api/src/routes/discover.ts`
- Register in `index.ts` alongside attestation routes

---

## 5. What Needs to Be Built

### New: Supabase Migration — `agent_index` table

```sql
-- supabase/migrations/20260306000000_agent_index.sql
CREATE TABLE agent_index (
  id           TEXT PRIMARY KEY,        -- "erc8004:42", "hol:abc123", "clawhub:skill-name"
  name         TEXT NOT NULL,
  description  TEXT,
  entity_type  TEXT DEFAULT 'agent',    -- "agent" | "skill"
  protocols    TEXT[] NOT NULL DEFAULT '{}',
  capabilities TEXT[] DEFAULT '{}',
  endpoints    JSONB DEFAULT '{}',
  raw_meta     JSONB DEFAULT '{}',
  claimed      BOOLEAN DEFAULT false,
  trust_score  NUMERIC(5,2),            -- pre-cached, refreshed by crawler
  confidence   NUMERIC(4,4),
  risk_level   TEXT,
  source       TEXT NOT NULL,           -- "erc8004" | "hol" | "clawhub" | "a2a_probe"
  indexed_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_agent_protocols    ON agent_index USING GIN(protocols);
CREATE INDEX idx_agent_capabilities ON agent_index USING GIN(capabilities);
CREATE INDEX idx_agent_trust_score  ON agent_index(trust_score DESC NULLS LAST);
CREATE INDEX idx_agent_source       ON agent_index(source);
CREATE INDEX idx_agent_claimed      ON agent_index(claimed) WHERE claimed = true;
CREATE INDEX idx_agent_updated      ON agent_index(updated_at DESC);
```

### New: ERC-8004 Crawler — `packages/core/src/crawlers/erc8004-crawler.ts`

```typescript
// Key responsibilities:
// 1. eth_getLogs: scan Transfer events from=0x000...0 to find all minted token IDs
// 2. For each token ID: call tokenURI(id) → parse RegistrationFile
// 3. Extract: name, description, services[] → protocols, capabilities, endpoints
// 4. Call ownerOf(id) → owner_address for erc8004 provider snapshot
// 5. Run engine.query({namespace:'erc8004', id}) → trust_score, confidence, risk_level
// 6. Upsert into agent_index

// Reuses: ERC8004Provider.fetchRegistration() (private — may need to expose)
// Reuses: ERC8004Provider.rpcCall() (private — extract to shared rpcCall utility)
// New: event log scanning logic
// New: batch processing (100 tokens per batch, rate-limited)
```

**Services[] → Protocols/Capabilities mapping:**
```typescript
const SERVICE_TO_PROTOCOL: Record<string, string> = {
  'a2a': 'a2a', 'mcp': 'mcp', 'acp': 'acp',
  'ens': 'ens', 'did': 'did',
};
const SERVICE_TO_CAPABILITY: Record<string, string[]> = {
  'forecasting': ['forecasting'],
  'trading': ['trading'],
  'defi': ['defi', 'yield'],
  // expand as registry patterns emerge
};
```

### New: /discover Route — `apps/api/src/routes/discover.ts`

**Data flow per request:**

```
GET /v1/discover?capability=forecasting&min_score=70&limit=20
         │
         ▼
1. Parse + validate query params (zod or manual)
         │
         ▼  
2. SQL query on agent_index (Supabase)
   SELECT * FROM agent_index
   WHERE (capabilities @> $capabilities OR $capabilities IS NULL)
     AND (protocols && $protocols OR $protocols IS NULL)
     AND (trust_score >= $min_score AND trust_score <= $max_score)
     AND (claimed = true OR $claimed IS NULL)
   ORDER BY trust_score DESC
   LIMIT $limit OFFSET $offset
         │
         ▼
3. For each result: check trust_cache (AegisEngine internal)
   - Cache HIT (TTL not expired): use cached TrustResult
   - Cache MISS: engine.query(subject) — async fan-out to providers
   - Batch: Promise.allSettled() with per-subject timeout (5s)
         │
         ▼
4. Build AgentSummary[] by joining:
   - agent_index row → id, name, description, protocols, capabilities, endpoints, claimed
   - TrustResult → trust_score, confidence, risk_level, recommendation
   - TrustResult.signals → per-provider snapshots (moltbook, github, erc8004, clawhub)
   - identityGraph.resolveAll() → linked_identifiers[]
         │
         ▼
5. Serialize → DiscoverResponse
```

**Note on live score fan-out in Phase 1:**
- For small result sets (≤20 agents after SQL filter), running `engine.query()` on each is acceptable
- Score is already cached by AegisEngine after first query — repeated requests are O(1)
- Only truly cold agents (never queried) hit provider APIs → add a 5s timeout guard

**The `/v1/discover/protocols` and `/v1/discover/capabilities` sub-routes** are simple SQL aggregations:
```sql
SELECT unnest(protocols) AS proto, COUNT(*) FROM agent_index GROUP BY proto ORDER BY count DESC;
SELECT unnest(capabilities) AS cap, COUNT(*) FROM agent_index GROUP BY cap ORDER BY count DESC;
```

---

## 6. Implementation Plan — Phased

### Phase 1 (This Sprint): Minimal Viable Discover

**Goal:** Working `/discover` endpoint queryable by `capability`, `protocol`, `min_score`, `limit`, `offset`

1. **Migration**: `supabase/migrations/20260306000000_agent_index.sql` — create `agent_index` table
2. **DB helpers**: Add `upsertAgentIndex`, `queryAgentIndex`, `agentIndexStats` to `apps/api/src/db.ts`
3. **Crawler (basic)**: `packages/core/src/crawlers/erc8004-crawler.ts`
   - Event log scan for Transfer(from=0x0) events → token IDs
   - Batch fetch tokenURI (100 at a time)
   - Upsert to agent_index with source='erc8004'
   - Expose as CLI: `pnpm crawl:erc8004` (one-shot; run manually to seed)
4. **Route**: `apps/api/src/routes/discover.ts`
   - `GET /v1/discover` — filter + sort + paginate from agent_index
   - `GET /v1/discover/protocols` — protocol aggregation
   - `GET /v1/discover/capabilities` — capability aggregation
   - Export `registerDiscoverRoutes(server)`
5. **Wire-up**: Register in `apps/api/src/index.ts` alongside attest routes
6. **Tests**: At minimum, integration tests for route parsing + response shape

**Effort estimate:** ~3–4 days of focused engineering

### Phase 2 (Next Sprint): Protocol Breadth

- A2A card probe job: for agents in `agent_index` with `services[].name='a2a'`, fetch `/.well-known/agent-card.json` → extract skills[] → update `capabilities[]`
- HOL.org import job: when API is back up, bulk-ingest their agent list → upsert `source='hol'` rows
- `claimed` filter: join with `identity_links` to verify cross-namespace claims
- ClawHub import: `/api/v1/skills?limit=50` paginated → upsert `source='clawhub'`
- `?fresh=true` param: bypass agent_index cache, run live engine.query()

### Phase 3 (Hackathon Window): Dynamic Signals + Semantic Search

- pgvector: embed `description` fields from agent_index → `q` free-text search via cosine similarity
- Trade performance provider: Brier score, win rate from on-chain resolved trades
- API uptime provider: periodic HTTP probe of declared endpoints
- Continuous re-crawl: event-triggered (ERC-8004 Transfer events via WebSocket)
- `min_confidence` filter param

---

## 7. Open Questions Resolved / Still Open

### Resolved

- **ERC-8004 enumeration**: Use Transfer event logs, NOT totalSupply(). The contract does not implement ERC-721 Enumerable.
- **t54 Labs**: Not a discovery competitor. Different lane (payment security). No public discovery API found.
- **HOL.org API**: Real but currently 503. Treat as Phase 2 dependency, not Phase 1 blocker.
- **Route pattern**: Follow `registerAttestRoutes` modular pattern.

### Still Open

1. **Event log scanning at scale**: How many minted tokens does the ERC-8004 registry have? Need to scan from block 0 (Base mainnet: genesis ~2023-06-01) to current. Estimate: Base has ~43M blocks as of 2026-03-06. At 1000 blocks/request = ~43K RPC calls for full history. Use a public Base archive node or QuickNode — confirm rate limits.

2. **Remote tokenURIs**: The existing `parseTokenUri` throws on IPFS/HTTP URIs. At crawl scale, some agents will have `ipfs://...` URIs. Need a resolver (public IPFS gateway, or Pinata) before those agents can be indexed. Count how many are affected before deciding.

3. **Crawl frequency / TTL**: For the trust score cache in `agent_index`: suggest 1h for agents with recent on-chain activity, 24h for dormant. Background re-crawl job (cron) vs. event-triggered (Transfer WebSocket).

4. **Supabase or local**: Phase 1 can work with in-memory fallback (no Supabase needed for dev). For production, Supabase is already wired.

5. **`q` semantic search backend**: pgvector in Supabase (already on their platform) vs. OpenAI embeddings vs. local. pgvector is the zero-additional-cost option since we're already on Supabase.

---

## 8. Key Files to Create / Modify

| File | Action | Notes |
|---|---|---|
| `supabase/migrations/20260306000000_agent_index.sql` | CREATE | New table + indexes |
| `apps/api/src/db.ts` | MODIFY | Add agent_index helpers |
| `packages/core/src/crawlers/erc8004-crawler.ts` | CREATE | ERC-8004 event log crawler |
| `apps/api/src/routes/discover.ts` | CREATE | Main route handler |
| `apps/api/src/index.ts` | MODIFY | Register discover routes |
| `packages/core/src/providers/erc8004.ts` | MODIFY | Expose `fetchRegistration` / `rpcCall` for crawler reuse |

---

*Research by Charon | TrstLyr Protocol v0.2 | 2026-03-06*
