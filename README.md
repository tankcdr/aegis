# Aegis

**An open trust protocol for the agent internet.**

Aegis is a trust abstraction layer that lets any agent, skill marketplace, or platform answer one question: *"How much should I trust this entity?"*

It aggregates trust signals from web2 sources (GitHub, Moltbook, ClawHub, npm) and web3 sources (ERC-8004, on-chain reputation, staking, TEE attestation) through a single, unified API. No blockchain required to start. Progressive trust as stakes increase.

## The Problem

Agent ecosystems are growing fast. OpenClaw has hundreds of skills on ClawHub. Moltbook has 1,200+ registered agents. MCP and A2A are connecting agents across organizational boundaries.

None of them have trust infrastructure.

- Skills are unsigned — anyone can publish, no identity verification
- No reputation system for skill authors or agents
- No audit trails — install a skill and hope for the best
- A credential stealer was [already found](https://moltbook.com) disguised as a weather skill on ClawHub
- [ERC-8004](https://eips.ethereum.org/EIPS/eip-8004) proposes on-chain agent trust, but most agents today are web2

The agent internet needs a trust layer. Aegis is that layer.

## Architecture

```
┌──────────────────────────────────────────┐
│            Trust Query API               │
│  "Should I trust agent X / skill Y?"     │
└─────────────────┬────────────────────────┘
                  │
┌─────────────────▼────────────────────────┐
│        Trust Aggregation Engine          │
│   Normalize · Weight · Compose · Score   │
└─────────────────┬────────────────────────┘
                  │
     ┌────────────┼────────────┐
     ▼            ▼            ▼
┌─────────┐ ┌─────────┐ ┌──────────┐
│  Web2   │ │  Web3   │ │ Verified │
│ Signals │ │ Signals │ │  Audits  │
├─────────┤ ├─────────┤ ├──────────┤
│ GitHub  │ │ERC-8004 │ │Community │
│ Moltbook│ │ Staking │ │ Scanner  │
│ ClawHub │ │  zkML   │ │YARA/SAST │
│   npm   │ │   TEE   │ │  Manual  │
└─────────┘ └─────────┘ └──────────┘
```

## Quick Example

```bash
# How much should I trust this ClawHub skill?
curl -X POST https://aegis.example/v1/trust/query \
  -H "Content-Type: application/json" \
  -d '{
    "subject": {
      "type": "skill",
      "namespace": "clawhub",
      "id": "eudaemon_0/security-scanner"
    },
    "context": {
      "action": "install",
      "risk_level": "high"
    }
  }'
```

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
      "signal": "author_reputation",
      "score": 0.91,
      "evidence": {
        "account_age_days": 1140,
        "public_repos": 214,
        "followers": 892
      }
    },
    {
      "provider": "moltbook",
      "signal": "community_karma",
      "score": 0.88,
      "evidence": {
        "karma": 6855,
        "posts": 47,
        "account_verified": true
      }
    },
    {
      "provider": "community_audit",
      "signal": "security_scan",
      "score": 0.85,
      "evidence": {
        "auditors": 3,
        "findings": 0,
        "last_audit": "2026-02-20"
      }
    }
  ],
  "unresolved": [
    {
      "provider": "erc8004",
      "reason": "no_on_chain_identity"
    }
  ]
}
```

## Design Principles

1. **Web2/Web3 Agnostic** — Works with a GitHub account. Scales to on-chain proofs. No wallet required to participate.
2. **Pluggable Signal Providers** — Anyone can build and register a new trust signal source. The protocol aggregates whatever is available.
3. **Progressive Trust** — Low-stakes interactions use web2 signals. High-stakes interactions can require on-chain validation. Security proportional to value at risk.
4. **Transparent Scoring** — Every trust score comes with evidence. No black boxes.
5. **Protocol, Not Product** — Open spec, open source. Platforms embed it; they don't rebuild it.

## Documentation

- **[Protocol Specification](docs/SPEC.md)** — Full protocol spec (start here)
- **[Architecture](docs/ARCHITECTURE.md)** — Component design and data flow
- **[Signal Providers](docs/PROVIDERS.md)** — How to build and register a provider

## Project Status

🚧 **Draft specification** — Seeking feedback from the agent ecosystem community.

## Roadmap

| Phase | Milestone | Status |
|-------|-----------|--------|
| 1 | Core API + GitHub/Moltbook/ClawHub providers | 🔜 |
| 2 | OpenClaw skill integration, community audit system | Planned |
| 3 | ERC-8004 bridge, on-chain attestations | Planned |
| 4 | x402 payments, advanced validation (zkML, TEE) | Planned |

## Related Work

- [ERC-8004: Trustless Agents](https://eips.ethereum.org/EIPS/eip-8004) — On-chain agent identity, reputation, and validation registries
- [OpenClaw](https://github.com/openclaw/openclaw) — Agent runtime and skill ecosystem
- [ClawHub](https://clawhub.ai) — Skill marketplace for OpenClaw agents
- [Moltbook](https://moltbook.com) — Social network for AI agents

## Contributing

This project is in the specification phase. Feedback on the [protocol spec](docs/SPEC.md) is welcome — open an issue or submit a PR.

## License

Apache 2.0 — see [LICENSE](LICENSE).

## Author

[Chris Madison](https://github.com/tankcdr) / [Long Run Advisory](https://longrunadvisory.com)
