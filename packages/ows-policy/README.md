# @trstlyr/ows-policy

Trust-gated signing policy for the [Open Wallet Standard](https://github.com/nichanank/open-wallet-standard) (OWS). Wraps OWS signing operations with a pre-flight TrstLyr trust check at the application layer.

> OWS policies are static JSON registered in the vault. This package adds **dynamic trust evaluation** at the call site — it is not a native OWS plugin but an application-layer adapter.

## Install

```bash
npm install @trstlyr/ows-policy @open-wallet-standard/core
```

## Quick Start

```ts
import { TrustPolicy } from '@trstlyr/ows-policy';

const policy = new TrustPolicy({
  minScore: 65,
  trstlyr: { apiKey: process.env.TRSTLYR_API_KEY },
});

// Check trust, then sign if it passes
const result = await policy.checkAndSign({
  wallet: 'my-wallet',
  chain: 'base',
  txHex: '0x...',
  subject: 'github:torvalds',
});

console.log(result.signature);
console.log(result.trustCheck.score); // e.g. 82
```

## Build an Allowlist Policy

Generate OWS-compatible policy JSON with only trusted addresses:

```ts
const policyJson = await policy.buildAllowlistPolicy(
  ['github:torvalds', 'erc8004:31977', 'github:suspicious-user'],
  'my-policy-id',
);

// Pass to OWS createPolicy()
// Only subjects scoring >= minScore are included in the allowlist
```

## Configuration

| Option | Type | Default | Description |
|---|---|---|---|
| `minScore` | `number` | `60` | Block signing if trust score is below this |
| `requireLedgerBelow` | `number` | `40` | Flag for hardware wallet approval below this score |
| `trstlyr` | `ClientConfig` | `undefined` | Pass-through to `@trstlyr/sdk` `configure()` |
| `failOpen` | `boolean` | `true` | If TrstLyr API is unreachable, allow signing anyway |

## Error Handling

When a subject's trust score is below `minScore`, `checkAndSign` throws a `TrustGateDeniedError`:

```ts
import { TrustGateDeniedError } from '@trstlyr/ows-policy';

try {
  await policy.checkAndSign({ ... });
} catch (err) {
  if (err instanceof TrustGateDeniedError) {
    console.log(err.trustCheck.score);       // 23
    console.log(err.trustCheck.riskLevel);   // "high"
    console.log(err.trustCheck.allowed);     // false
  }
}
```

## Preflight Check Only

Run a trust check without signing:

```ts
const check = await policy.preflightCheck('github:torvalds');
if (check.allowed) {
  // proceed with your own signing logic
}
```

## License

Apache-2.0
