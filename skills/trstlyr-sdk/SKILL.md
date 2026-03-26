---
name: trstlyr-sdk
description: Use the @trstlyr/sdk npm package to check agent trust scores and post behavioral attestations via the TrstLyr API. Use when building agent systems that need to verify counterparty trust before transacting, delegating, or collaborating. Covers installation, the functional API (score, gate, isTrusted, behavioral), middleware for Express/Fastify, error handling, and publishing the package to npm.
---

# @trstlyr/sdk

Zero-dependency TypeScript SDK for the TrstLyr trust API at `https://api.trstlyr.ai`.

## Install

```bash
npm install @trstlyr/sdk
```

## Core API

```ts
import { score, gate, isTrusted, behavioral, configure } from '@trstlyr/sdk';

// Query trust score
const result = await score('github:vbuterin');
// result.trust_score (0-100), result.risk_level, result.recommendation

// Boolean check
const trusted = await isTrusted('erc8004:31977', 60); // true if score >= 60

// Gate — throws TrustGateError if below threshold, resolves with score if passes
const trustResult = await gate('erc8004:31977', { minScore: 60 });

// Behavioral attestation after an interaction
await behavioral({
  subject: 'erc8004:31977',
  outcome: 'success',     // 'success' | 'failure' | 'dispute'
  rating: 5,              // 1-5
  value_usd: 100,         // optional
  attestor: 'erc8004:99', // optional
});
```

## Subject Formats

| Format | Example |
|--------|---------|
| `erc8004:<id>` | `erc8004:31977` |
| `github:<user>` | `github:tankcdr` |
| `moltbook:<handle>` | `moltbook:nyx` |
| `clawhub:<skill>` | `clawhub:weather` |
| `twitter:<handle>` | `twitter:trstlyr` |

## Configuration

```ts
configure({
  apiKey: 'sk-...',    // optional — for higher rate limits
  timeout: 5000,       // ms, default 5000
  strict: false,       // true = throw on API unreachable; false = fail open (default)
});
```

**Fail-open by default:** If `api.trstlyr.ai` is unreachable, `score()` returns `confidence: 0` and `gate()` passes silently. Set `strict: true` to throw instead.

## Middleware

```ts
import { trustGate, trustGateHook } from '@trstlyr/sdk/middleware';

// Express
app.use(trustGate({
  subjectFrom: (req) => req.headers['x-agent-id'] as string,
  minScore: 60,
}));

// Fastify
server.addHook('onRequest', trustGateHook({
  subjectFrom: (req) => req.headers['x-agent-id'] as string,
  minScore: 60,
}));
```

## Error Types

```ts
import { TrustGateError, PaymentRequiredError, TrstLyrError } from '@trstlyr/sdk';

try {
  await gate('erc8004:31977', { minScore: 80 });
} catch (e) {
  if (e instanceof TrustGateError) {
    console.log(e.subject, e.actualScore, e.threshold);
  }
}
```

| Error | When |
|-------|------|
| `TrustGateError` | Score below threshold |
| `PaymentRequiredError` | API requires x402 payment (repeat queries) |
| `TrstLyrError` | Base class for all SDK errors |

## Publishing to npm

The package is at `packages/sdk` in the aegis monorepo.

```bash
cd ~/dev/tankcdr/aegis/packages/sdk

# Login with @trstlyr npm org credentials
npm login

# Build and publish
pnpm build
npm publish
```

Requires npm org access to `@trstlyr`. The `publishConfig.access: 'public'` is already set.

## Live API

- Score endpoint: `GET https://api.trstlyr.ai/v1/trust/score/:subject`
- First query per subject: free
- Subsequent: $0.01 USDC via x402 on Base (SDK surfaces as `PaymentRequiredError`)
