# TrstLyr Protocol — Demo Narration Script

**Target length:** ~2.5 minutes
**Setup:** Browser open to `trstlyr.ai`, screen recording at 1080p

---

## INTRO (0:00 – 0:25)

> Hey, I'm Chris. This is TrstLyr Protocol — trust infrastructure for the agent internet.
>
> Here's the problem: we're building a world where AI agents transact autonomously — they trade, delegate tasks, access data. But right now there's no standard way for one agent to ask: "Should I trust this other agent?"
>
> TrstLyr answers that question. We aggregate signals from on-chain registries, code repos, social identity, and ZK-verified credentials — then fuse them into a single score using Subjective Logic. Let me show you it working live.

## SECTION 1 — API Health / Providers (0:25 – 0:50)

*Point to the provider list on the page*

> First — this is a live API running right now. You can see all seven trust signal providers online: GitHub, Twitter, ERC-8004, ClawHub, Moltbook, Self Protocol, and behavioral attestations.
>
> Each one is an independent source of truth. TrstLyr doesn't pick one — it fuses all of them. More signals means higher confidence.

## SECTION 2 — Trust Score Query (0:50 – 1:50)

*Type `github:tankcdr` in the query box and hit Check*

> Let me query my own account — `github:tankcdr`. This is my real GitHub. I've already registered it on TrstLyr and linked it to my wallet and my Self Protocol identity.
>
> *Wait for result*
>
> Look at the breakdown. Four signals firing:
>
> GitHub is looking at repo history, commit frequency, followers — I've got 72 public repos and an account going back to 2013.
>
> Twitter is picking up my social presence via the linked identity.
>
> And here's the interesting one — Self Protocol. That's a ZK proof-of-human. I have a verified Self Agent ID on Celo Mainnet — a soulbound token that proves I'm a real person, not a bot. That signal scores 0.95 with 0.85 confidence. It has the most weight in the final score.
>
> The system resolved all of this automatically from a single `github:tankcdr` query — it traversed the identity graph: GitHub to wallet to Self. I didn't have to tell it anything.
>
> See the confidence percentage? That's the system being honest about how much evidence it has. High score, high confidence — this is a real person with a real track record.

## SECTION 3 — Behavioral Attestation (1:50 – 2:20)

*Navigate to the attestation section, click "Submit Attestation"*

> Now — behavioral attestations. Agents can vouch for each other's behavior, like a peer review system.
>
> *Wait for 402 response*
>
> We get a 402 — Payment Required. This is a feature, not a bug.
>
> Every attestation requires a $0.01 USDC micropayment via the x402 protocol — machine-native HTTP payments. Why? Because free attestations get Sybil attacked. One penny binds every review to a real on-chain identity. That's what makes the behavioral signal trustworthy over time.

## CLOSE (2:20 – 2:35)

> That's TrstLyr Protocol. Web2 reputation, on-chain identity, and ZK-verified humanity — fused into one score. Seven providers, live on Base Mainnet, today. Thanks.

---

**Tips for recording:**
- Pre-load `trstlyr.ai` so the provider list is already populated
- Type `github:tankcdr` fresh on camera — don't pre-fill it
- Pause 1–2s after clicking Check — let the score animate in
- Score will show ~71 with 4 signals — that's the money shot
- If a response is slow, fill the silence: "hitting the live API right now..."
