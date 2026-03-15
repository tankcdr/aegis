# TrstLyr Protocol — Agents for Public Goods Data Collection for Project Evaluation

## The Problem: Evaluating Projects at Scale Requires Better Data Infrastructure

Grant programs, public-goods funding rounds, and ecosystem evaluators face the same bottleneck: assessing hundreds of projects with fragmented, self-reported data. Human reviewers cannot cross-reference GitHub commit history, on-chain activity, social presence, and registry metadata for every applicant — yet each signal alone tells an incomplete story. The result is evaluation decisions made on vibes, popularity, or whichever data is easiest to access.

TrstLyr Protocol solves this by autonomously collecting, aggregating, and attesting multi-source trust signals for any agent, developer, or project — producing a queryable, on-chain evaluation dataset that is itself a public good.

## Multi-Source Signal Aggregation

TrstLyr's scoring engine fuses qualitative and quantitative data from five independent providers:

- **GitHub** — repository health, author reputation, commit recency, community engagement
- **ERC-8004** — on-chain identity registration, service diversity, active status
- **ClawHub** — skill installs, stars, downloads, version cadence
- **Twitter/X** — social presence and cross-namespace identity verification
- **Moltbook** — decentralized portfolio attestations

Each provider returns normalized signals with explicit confidence values. The engine applies Subjective Logic Cumulative Belief Fusion (CBF) to combine them — correctly handling missing data, unknown entities, and conflicting signals without discarding uncertainty. This is qualitative + quantitative evaluation at a scale no human team can match.

## <200ms Scoring Across 5 Providers

All five providers are queried in parallel with a 10-second timeout per provider. In practice, full evaluations complete in under 200ms. The engine surfaces cross-provider patterns — a GitHub account with high commit volume but zero on-chain presence, or an ERC-8004 registration with no linked code — that would take a human evaluator minutes per project and hours across a cohort.

## Dual-Proof Identity Linking = Higher Signal Provenance

TrstLyr implements dual-proof identity verification: linking identities across namespaces (e.g., `twitter:user` ↔ `github:user`) requires posting a matching challenge token in both mediums simultaneously. This raises the cost of Sybil attacks and ensures the provenance chain from signal source to evaluation record is cryptographically anchored. Higher provenance quality means downstream consumers — grant reviewers, protocol governance, funding allocators — can trust the data without re-verifying it themselves.

## On-Chain Attestations = Permanent Public Evaluation Dataset

Every trust evaluation can be anchored as an Ethereum Attestation Service (EAS) attestation on Base Mainnet. The attestation schema captures: subject identifier, trust score, confidence, risk level, signal summary, and query ID. These records are:

- **Public** — anyone can query them via the EAS GraphQL API or on-chain
- **Permanent** — immutable once attested; the evaluation record outlives the evaluator
- **Composable** — other protocols can build on TrstLyr attestations for gating, reputation, or governance

This transforms evaluations from ephemeral spreadsheet rows into durable, machine-readable public infrastructure.

## Example: Evaluating a Gitcoin Grant Applicant

Consider a grant reviewer evaluating `github:user/project`. TrstLyr scores it in one call:

```
GET /v1/trust/score/github:user/project
```

The engine resolves the author's linked identities, fans out to all relevant providers, fuses the signals, and returns a trust score with confidence interval, risk level, and fraud flags — all in under 200ms. The reviewer sees not just a number but a signal-by-signal breakdown: strong commit history, moderate community engagement, no on-chain identity, no Sybil indicators. If the score meets the threshold, the evaluation is attested on-chain, joining a growing corpus of public evaluation data.

## Why This Matters for Public Goods

Public goods funding suffers from information asymmetry. Applicants know more about their projects than evaluators do, and evaluators lack the tooling to close that gap at scale. TrstLyr closes it by making evaluation data collection autonomous, multi-source, and cryptographically verifiable.

TrstLyr does not just collect data — it attests it on-chain, making the evaluation record itself a public good.
