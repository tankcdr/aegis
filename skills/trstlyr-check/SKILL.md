---
name: trstlyr
description: Check an agent's trust score before transacting. TrstLyr is the reputation layer for the agent internet — aggregates GitHub, ERC-8004, Moltbook, Twitter, ClawHub, and behavioral attestations into a verifiable on-chain trust score.
tags: [trust, reputation, security, erc8004, agents]
---

# TrstLyr — Agent Trust Scores

## Goal

Before letting an agent touch your money, code, or data — verify it. TrstLyr aggregates signals from across the agent internet into a single trust score, anchored on Base Mainnet via EAS attestations.

Use this skill to:
- Check if an agent is safe to transact with before a swap, payment, or delegation
- Gate high-value MoonPay operations by trust threshold
- Get on-chain proof of an agent's reputation

## API

**Base URL:** `https://api.trstlyr.ai`

No API key required to query trust scores. First attestation per subject is free; subsequent queries cost $0.01 USDC via x402.

## Check an Agent's Trust Score

```bash
curl -X POST https://api.trstlyr.ai/v1/attest \
  -H "Content-Type: application/json" \
  -d '{"subject": "<namespace>:<id>"}'
```

### Subject Formats

| Namespace | Example | Resolves From |
|-----------|---------|---------------|
| `erc8004` | `erc8004:31977` | On-chain ERC-8004 agent registry |
| `github` | `github:tankcdr` | GitHub profile + activity |
| `moltbook` | `moltbook:nyx` | Moltbook agent profile |
| `clawhub` | `clawhub:weather` | ClawHub skill registry |
| `twitter` | `twitter:trstlyr` | Twitter/X profile |

### Response

```json
{
  "subject": "erc8004:31977",
  "trust_score": 73.68,
  "confidence": 0.97,
  "risk_level": "low",
  "recommendation": "install",
  "attestation_uid": "0xabc...",
  "attestation_url": "https://base.easscan.org/attestation/view/0xabc...",
  "on_chain": true,
  "signals_used": 4,
  "computed_at": "2026-03-25T22:23:10Z",
  "payment": {
    "amount_usdc": "0.01",
    "token": "USDC",
    "network": "Base Mainnet"
  }
}
```

### Trust Score Interpretation

| Score | Risk Level | Recommendation | Suggested Action |
|-------|-----------|----------------|-----------------|
| 80–100 | low | install | Proceed — safe to transact |
| 60–79 | low | install | Proceed with normal limits |
| 40–59 | medium | review | Reduce transaction size or require Ledger approval |
| 20–39 | high | caution | Require manual review before any transaction |
| 0–19 | critical | reject | Do not transact |

## Paying via x402 (Repeat Queries)

If you've already used your free query for a subject, the API returns `402 Payment Required`. Use `mp x402 request` to pay automatically:

```bash
mp x402 request \
  --method POST \
  --url https://api.trstlyr.ai/v1/attest \
  --body '{"subject": "erc8004:31977"}' \
  --wallet <your-wallet> \
  --chain base
```

Cost: $0.01 USDC on Base Mainnet per attestation.

## Trust-Gated Swap Pattern

Check trust before executing a high-value swap. Reject or require Ledger approval if score is below threshold.

```bash
# 1. Check trust score for the counterparty agent
RESULT=$(curl -s -X POST https://api.trstlyr.ai/v1/attest \
  -H "Content-Type: application/json" \
  -d '{"subject": "erc8004:<counterparty-agent-id>"}')

SCORE=$(echo $RESULT | python3 -c "import json,sys; print(json.load(sys.stdin)['trust_score'])")
RISK=$(echo $RESULT | python3 -c "import json,sys; print(json.load(sys.stdin)['risk_level'])")

echo "Trust score: $SCORE | Risk: $RISK"

# 2. Gate on score
if (( $(echo "$SCORE >= 60" | bc -l) )); then
  echo "Trust check passed — proceeding with swap"
  mp token swap --from USDC --to ETH --amount 500 --chain base
else
  echo "Trust check FAILED (score: $SCORE) — swap blocked"
  echo "Attestation: $(echo $RESULT | python3 -c "import json,sys; print(json.load(sys.stdin)['attestation_url'])")"
fi
```

## Behavioral Attestations

After an agent interaction completes, both parties can attest on-chain — recording outcome, rating, and value at stake. These feed back into future trust scores.

```bash
curl -X POST https://api.trstlyr.ai/v1/attest/behavioral \
  -H "Content-Type: application/json" \
  -d '{
    "subject": "erc8004:<agent-id>",
    "outcome": "success",
    "rating": 5,
    "value_usd": 100,
    "attestor": "erc8004:<your-agent-id>"
  }'
```

## Check Behavioral History

```bash
curl https://api.trstlyr.ai/v1/trust/behavior/<subject>
```

## Related Skills

- **moonpay-x402** — pay for trust queries via x402 micropayments
- **moonpay-hardware-wallet** — require Ledger approval for low-trust agents
- **moonpay-swap-tokens** — execute swaps after trust check passes
