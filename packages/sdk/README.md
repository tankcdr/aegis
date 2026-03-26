# @trstlyr/sdk

Lightweight, zero-dependency SDK for the [TrstLyr](https://trstlyr.ai) trust API. Query trust scores and post behavioral attestations in one line.

Works in Node.js 18+, Bun, Deno, and browsers.

## Install

```bash
npm install @trstlyr/sdk
```

## Quick Start

```ts
import { score, attest, behavioral, isTrusted, gate } from '@trstlyr/sdk';

// Query a trust score
const result = await score('github:vbuterin');
console.log(result.trust_score, result.risk_level, result.recommendation);

// Simple boolean check
if (await isTrusted('erc8004:31977', 60)) {
  // proceed
}

// Gate — throws TrustGateError if score < threshold
const trustResult = await gate('erc8004:31977', { minScore: 60 });

// On-chain attestation (EAS on Base)
const att = await attest('github:tankcdr');
console.log(att.attestation_uid, att.attestation_url);

// Behavioral attestation after an interaction
await behavioral({
  subject: 'erc8004:31977',
  outcome: 'success',
  rating: 5,
  value_usd: 100,
});
```

## Client Class

For more control, instantiate `TrstLyrClient` directly:

```ts
import { TrstLyrClient } from '@trstlyr/sdk';

const client = new TrstLyrClient({
  apiKey: process.env.TRSTLYR_API_KEY,
  baseUrl: 'https://api.trstlyr.ai',
  timeout: 5000,
});

const result = await client.score('github:vbuterin');
const history = await client.behaviorHistory('erc8004:31977');
```

## Middleware

### Express

```ts
import { trustGate } from '@trstlyr/sdk/middleware';

app.use(trustGate({
  subjectFrom: (req) => req.headers['x-agent-id'] as string,
  minScore: 60,
  onBlock: (subject, score) => ({
    status: 403,
    message: `Agent ${subject} blocked: score ${score?.trust_score}`,
  }),
}));
```

### Fastify

```ts
import { trustGateHook } from '@trstlyr/sdk/middleware';

server.addHook('onRequest', trustGateHook({
  subjectFrom: (req) => req.headers['x-agent-id'] as string,
  minScore: 60,
}));
```

## Fail-Open by Default

If the TrstLyr API is unreachable, the SDK logs a warning but does **not** throw. This prevents trust-check timeouts from killing your agent. To fail closed instead:

```ts
import { gate, configure } from '@trstlyr/sdk';

// Functional API
await gate('erc8004:31977', { minScore: 60, strictMode: true });

// Client
const client = new TrstLyrClient({ strictMode: true });

// Middleware
app.use(trustGate({ subjectFrom: ..., strictMode: true }));
```

## Subject Format

Subjects follow the `namespace:id` pattern:

| Namespace | Example |
|-----------|---------|
| `github` | `github:vbuterin` |
| `erc8004` | `erc8004:31977` |
| `twitter` | `twitter:vaborin` |
| `ens` | `ens:vitalik.eth` |
| `wallet` | `wallet:0xAbc...` |

URLs are also accepted — the API normalizes them automatically.

## Error Types

| Error | When |
|-------|------|
| `TrstLyrError` | Base error for any API failure |
| `TrustGateError` | Subject's score is below the gate threshold |
| `PaymentRequiredError` | x402 — query requires payment |

## License

Apache-2.0
