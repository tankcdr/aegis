# Aegis

**The trust layer for the agent internet.**

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Spec Version](https://img.shields.io/badge/spec-v0.5.2--draft-orange)](docs/SPEC.md)
[![ERC-8004](https://img.shields.io/badge/ERC--8004-compatible-green)](https://eips.ethereum.org/EIPS/eip-8004)
[![EAS](https://img.shields.io/badge/attestation-EAS%20on%20Base-purple)](https://attest.org)

---

Aegis answers one question: **"How much should I trust this agent or skill?"**

It is the **Gitcoin Passport for agents** — aggregating trust signals from GitHub, Moltbook, ClawHub, ERC-8004 (Ethereum), and SATI (Solana) into a single, portable, evidence-backed trust score. No wallet required to start. Cross-chain by default. Progressive security as stakes increase.

```bash
curl -X POST https://aegis.example/v1/trust/query \
  -H "Content-Type: application/json" \
  -d '{
    "subject": { "type": "skill", "namespace": "clawhub", "id": "author/skill" },
    "context": { "action": "install", "risk_level": "high" }
  }'
```

```json
{
  "subject": "clawhub://author/skill",
  "trust_score": 0.87,
  "confidence": 0.72,
  "risk_level": "low",
  "recommendation": "install"
}
```

---

## The Problem

A credential stealer was discovered on ClawHub in January 2026 disguised as a weather skill. It read agent credentials from `~/.clawdbot/.env` and exfiltrated them to an external webhook. Detection was accidental — a community member ran YARA rules as a personal project.

This is not a ClawHub problem. It is an ecosystem problem:

- **Skills are unsigned.** Anyone can publish. No identity verification, no audit trail.
- **Agents have no reputation.** MCP tool calls, A2A task delegations, ClawHub installs — none of these build verifiable history.
- **On-chain trust is chain-siloed.** ERC-8004 (Ethereum) and SATI (Solana) are well-designed but cannot see each other. Most agents have no on-chain identity at all.
- **There is no cross-platform standard.** A high-reputation Moltbook agent is unknown to ClawHub. An ERC-8004 registered agent is invisible to SATI.

The agent internet is growing faster than its trust infrastructure. Aegis is that infrastructure.

---

## Why Not Just Use ERC-8004?

[ERC-8004](https://eips.ethereum.org/EIPS/eip-8004) is excellent — Aegis consumes it as a signal source. But ERC-8004 itself states: *"We expect reputation systems around reviewers/clientAddresses to emerge."*

**Aegis is that system.**

| | ERC-8004 | Aegis |
|---|---|---|
| Web2 signals (GitHub, Moltbook) | ❌ | ✅ |
| Cross-chain (Ethereum + Solana) | ❌ | ✅ |
| No wallet required | ❌ | ✅ |
| Pluggable signal providers | ❌ | ✅ |
| Fraud detection (Sybil, vouch rings) | ❌ | ✅ |
| Context-aware scoring | ❌ | ✅ |
| EAS attestation anchoring | ❌ | ✅ |

Aegis is the aggregation layer above ERC-8004 — not a replacement.

---

## How It Works

```
┌──────────────────────────────────────────────┐
│              Trust Query API                 │
│   POST /v1/trust/query   ·   Anonymous OK    │
└──────────────────┬───────────────────────────┘
                   │
┌──────────────────▼───────────────────────────┐
│          Trust Aggregation Engine            │
│                                              │
│  Subjective Logic opinion fusion             │
│  (belief, disbelief, uncertainty)            │
│                                              │
│  EigenTrust-transitive vouching              │
│  Ev-Trust evolutionary stability penalty     │
│  Context-aware weight adjustment (COBRA)     │
└──────────────────┬───────────────────────────┘
                   │
      ┌────────────┼─────────────┐
      ▼            ▼             ▼
 ┌─────────┐  ┌─────────┐  ┌──────────┐
 │  Web2   │  │  Web3   │  │  Fraud   │
 │ Signals │  │ Signals │  │Detection │
 ├─────────┤  ├─────────┤  ├──────────┤
 │ GitHub  │  │ERC-8004 │  │TF-IDF    │
 │Moltbook │  │  SATI   │  │Louvain   │
 │ ClawHub │  │  EAS    │  │EigenTrust│
 │   npm   │  │  x402   │  │Honeypots │
 └─────────┘  └─────────┘  └──────────┘
                   │
┌──────────────────▼───────────────────────────┐
│           EAS Attestation (Base L2)          │
│   On-chain anchor · IPFS evidence · ~$0.01   │
└──────────────────────────────────────────────┘
```

### Trust is not a number — it is an opinion

Aegis uses **Subjective Logic** (Jøsang, 2001) internally. Trust is expressed as `(belief, disbelief, uncertainty)` — distinguishing "no data yet" from "conflicting evidence." The API surfaces this as `trust_score` + `confidence` so consumers can act appropriately on both.

### Honest behavior is the dominant strategy

The scoring model incorporates **Ev-Trust** dynamics (Wang et al., arXiv:2512.16167): an evolutionary stability penalty discourages reputation farming by making pump-and-dump attacks yield lower effective scores than consistent honest behavior. Gaming the system is not just detected — it is made mathematically unprofitable.

---

## Key Features

- **One API, all signal sources** — GitHub, Moltbook, ClawHub, ERC-8004, SATI, EAS attestations, community audits. Query once; Aegis fans out.
- **Progressive trust** — Low-stakes interactions use web2 signals. High-stakes interactions require on-chain attestations or staked validation. Security proportional to value at risk.
- **MCP + A2A native** — Aegis plugs into agent communication protocols as a trust oracle. Query before accepting an MCP tool call or delegating an A2A task.
- **Fraud detection** — Five independent detectors: velocity anomalies, cross-provider consistency, coordinated behavior (Louvain community detection), behavioral fingerprinting (TF-IDF + IP analysis), honeypot traps.
- **EigenTrust-transitive vouching** — Vouch boosts scale with the voucher's own trust score and decay to zero for behaviorally similar identities (Sybil prevention built into the formula).
- **Exponential trust decay** — Inactive agents lose trust on a half-life curve per tier. Trust must be continuously earned, not hoarded.
- **Anonymous by default** — No caller ID required. Private identity links contribute to scoring without being exposed.
- **Protocol, not product** — Open spec (Apache 2.0). Embed it; extend it; run your own instance.

---

## Documentation

| Document | Description |
|----------|-------------|
| [**Protocol Specification**](docs/SPEC.md) | Full spec — start here. Covers API, scoring model, fraud detection, governance. |
| [Architecture](docs/ARCHITECTURE.md) | Component design, data flow, deployment models |
| [Signal Providers](docs/PROVIDERS.md) | How to build and register a provider |

### Spec Highlights

The specification (v0.5.2-draft) includes:

- **[Subjective Logic scoring model](docs/SPEC.md#71-subjective-logic-and-opinion-tuples)** — formal `(b, d, u)` opinion tuples with Bayesian fusion
- **[Evolutionary Stability Adjustment](docs/SPEC.md#79-evolutionary-stability-adjustment)** — Ev-Trust λ penalty making gaming unprofitable
- **[EAS attestation schema](docs/SPEC.md#91-ethereum-attestation-service-eas)** — on-chain trust anchoring with IPFS evidence
- **[Fraud Detection Engine](docs/SPEC.md#12-fraud-detection-engine)** — TF-IDF Sybil fingerprinting, Louvain vouch graph analysis
- **[Governance](docs/SPEC.md#15-governance)** — Snapshot voting, 4-of-7 multi-sig, 3-of-5 security council
- **[Appendix D — Adversarial Test Vectors](docs/SPEC.md#appendix-d-adversarial-test-vectors)** — 6 concrete attack scenarios with exact expected outputs

---

## Adversarial Test Vectors

**[Appendix D](docs/SPEC.md#appendix-d-adversarial-test-vectors)** defines 6 concrete attack scenarios drawn from the Ev-Trust malicious strategy taxonomy — each with exact inputs, expected JSON outputs, and key assertions.

| Vector | Attack | Primary Detector |
|--------|--------|-----------------|
| D.1 | Reverse-rater (competitor suppression) | Outlier audit rejection |
| D.2 | Compromised signal provider | Score distribution anomaly |
| D.3 | 3-agent vouch ring | Louvain community detection |
| D.4 | Sybil identity farm (10 agents) | TF-IDF behavioral fingerprint |
| D.5 | Pump-and-dump reputation exploit | Ev-Trust λ stability penalty |
| D.6 | 4-agent reciprocal vouch ring (K₄) | Reciprocity detector + TF-IDF |

**Conformance requirement:** A reference implementation that cannot produce outputs consistent with all six vectors MUST NOT be deployed as a public Aegis instance.

This level of adversarial coverage is rare in early-stage protocols. If you implement Aegis, run the test vectors first.

---

## Project Status

🚧 **Specification phase** — implementation begins at The Synthesis hackathon (March 2026).

| Phase | Milestone | Status |
|-------|-----------|--------|
| 1 | Core API · GitHub provider · EAS attestation · MCP/A2A hooks · Live demo | 🔜 March 2026 |
| 2 | OpenClaw skill · ClawHub integration · Community audits · Provider SDK | Planned |
| 3 | ERC-8004 + SATI bridge · Cross-chain identity · Gitcoin Grants | Planned |
| 4 | x402 payments · zkML · TEE · Governance launch · RetroPGF | Planned |

---

## Related Work

Aegis builds on and integrates with:

- [ERC-8004](https://eips.ethereum.org/EIPS/eip-8004) — On-chain agent identity (Ethereum/L2). Aegis is the aggregation layer above it.
- [SATI](https://github.com/cascade-protocol/sati) — ERC-8004-compatible trust on Solana. Aegis bridges the two.
- [EAS](https://attest.org) — Ethereum Attestation Service. Aegis uses EAS on Base L2 for on-chain trust anchoring.
- [x402](https://www.x402.org) — HTTP-native payments. Used for premium signal provider compensation.
- [Ev-Trust](https://arxiv.org/abs/2512.16167) — Wang et al. (2025). Evolutionary stable trust for LLM-based agent economies.
- [OpenClaw](https://github.com/openclaw/openclaw) — Agent runtime. Aegis is a proposed foundation project.
- [ClawHub](https://clawhub.com) — Skill marketplace. Integration target for Phase 2.
- [Moltbook](https://moltbook.com) — Agent social network. Signal provider for community karma.

---

## Contributing

The specification is open for feedback. If you work on agent frameworks, MCP/A2A tooling, on-chain identity, or security research — your input is valuable.

**Ways to contribute:**
- Open an issue with spec feedback, edge cases, or missing scenarios
- Submit a PR for clarifications, typo fixes, or new signal provider proposals
- Implement a signal provider and register it (see [Signal Providers](docs/PROVIDERS.md))
- Run the [adversarial test vectors](docs/SPEC.md#appendix-d-adversarial-test-vectors) against an implementation

**Discussion:** Open an issue or find us in the [OpenClaw Discord](https://discord.com/invite/clawd).

---

## Support the Protocol

Aegis is open-source infrastructure. If it's useful to you, consider contributing to its maintenance.

| Chain | Address |
|-------|---------|
| **ETH / Base** | `[multisig address — coming at v1.0]` |
| **BTC** | `[address — coming at v1.0]` |
| **SOL** | `[address — coming at v1.0]` |

Grant applications: [Gitcoin Grants](https://grants.gitcoin.co) · [Optimism RetroPGF](https://app.optimism.io/retropgf)

---

## License

Apache 2.0 — see [LICENSE](LICENSE).

## Author

[Chris Madison](https://github.com/tankcdr) / [Long Run Advisory](https://longrunadvisory.com)
