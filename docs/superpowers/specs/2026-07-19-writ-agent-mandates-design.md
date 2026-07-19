# Writ — Ledger-Enforced Agent Mandates

**Date:** 2026-07-19
**Event:** Build on Canton Hackathon (Encode Club / Canton Foundation)
**Deadline:** 2026-07-20 12:59 GMT+1
**Track:** Payments, Neobanking & Agentic Commerce

> **Authority is a contract, not a prompt.**

## Problem

Every enterprise wants AI agents to transact autonomously. Almost none permit it.

An agent's spending authority today lives in its **system prompt**. A prompt is not a
security boundary. One injection, one hallucinated zero, and the agent wires money it
was never meant to have access to. The industry's mitigation is "human in the loop,"
which forfeits the entire value of agentic commerce.

The missing primitive is **authority that is enforced outside the agent** — bounds the
agent cannot rewrite, argue with, or be talked out of.

## Why Canton specifically

Two properties are required simultaneously. No other platform provides both.

1. **Enforceable bounds.** The mandate is validated on the participant node when the
   transaction is submitted. A fully compromised agent — jailbroken, arbitrary code
   execution — still cannot produce a valid transaction outside its envelope.

2. **Private bounds.** The agent's reservation price and remaining budget are invisible
   to the counterparty. On a transparent ledger these leak and get gamed: a supplier who
   can read your max price will always charge exactly that. On a private database, bounds
   are not independently enforceable — you are trusting an operator.

Canton is the only environment where authority is both *cryptographically enforced* and
*commercially confidential*.

## Architecture

### Daml packages

Split deliberately, so `daml-script` is never uploaded to the shared Devnet validator
(the build emits an explicit warning about package-store bloat, and the validator is
shared with other hackathon teams).

- **`mandate-model`** — templates only. This is the DAR deployed to Devnet.
- **`mandate-test`** — Daml Script tests. Never uploaded.

### Templates

| Template | Signatory | Observer | Purpose |
|---|---|---|---|
| `Mandate` | Principal | **Agent only** | Authority envelope: caps, allowlist, expiry, `spentToDate`. Counterparty is deliberately *not* an observer — this is the privacy mechanism. |
| `Quote` | Counterparty | Agent | An offer. The counterparty never learns whether it falls inside the mandate. |
| `Deal` | Principal + Counterparty | — | Settled purchase. Created atomically with the mandate update. |

### The load-bearing choice

```haskell
choice Commit : (ContractId Mandate, ContractId Deal)
  with quoteCid : ContractId Quote
  controller agent
  do
    now <- getTime
    assertMsg "mandate expired"          (now < expiry)
    assertMsg "exceeds per-tx cap"       (amount <= perTxCap)
    assertMsg "exceeds total mandate"    (spentToDate + amount <= maxTotalSpend)
    assertMsg "counterparty not allowed" (cp `elem` allowedCounterparties)
    -- archive + recreate Mandate with updated spentToDate,
    -- create Deal — all atomic
```

The agent is the **controller** but not a **signatory**. It wields authority it cannot
modify. This asymmetry is the entire thesis, expressed in about six lines of Daml.

### Data flow

```
Principal ──issues──▶ Mandate ──(agent only)──▶ Agent
                         │                         │
                  reservation price           negotiates
                  INVISIBLE to ▼                   ▼
                  Counterparty ◀────Quote──── Counterparty Agent
                         │                         │
                         └───────── Commit ────────┘
                            atomic: Mandate' + Deal
```

## Frontend

Next.js (App Router, TypeScript, Tailwind) on Vercel. Satisfies the "link to live
product" deliverable.

1. **Issue Mandate** — principal defines the envelope.
2. **Live negotiation** — two Claude agents exchanging messages, streamed.
3. **Attack panel** — free-text prompt-injection box wired directly into an agent's
   context. The judge types the attack themselves.
4. **Privacy inspector** — party switcher showing the same transaction from three
   viewpoints. Demonstrates privacy rather than asserting it.

### Ledger client

**JSON Ledger API v2** over OAuth2 client-credentials (scope `daml_ledger_api`).

**Explicitly NOT `@daml/ledger` or `@daml/react`** — both are pinned to the 2.x line and
target the deprecated JSON API v1. Only `@daml/types` (3.5.2) is current. Generate a
typed client from the OpenAPI spec instead. This is the single most likely way to lose
hours to a stale tutorial.

### AI agents

Claude via **Vercel AI Gateway** (no raw key management, built-in observability).

## Deployment

- Local iteration: `dpm sandbox` (`daml` assistant is deprecated → `dpm` 1.0.21).
- Production: Seaport shared Devnet validator `5n sandbox` — no self-hosted validator,
  no onboarding secret, no IP allowlisting.
- Gating step: an organizer must add the project Party ID to the hackathon org. This is
  the only human-blocked dependency and was initiated first.

## Testing

Daml Script tests covering each rejection path:

- over per-transaction cap
- cumulative spend exceeding `maxTotalSpend`
- expired mandate
- counterparty not on the allowlist
- happy path within bounds

These double as evidence in the deck: *"here are the attacks the ledger rejects."*

## Scope discipline

The AI layer is **not load-bearing**. The thesis — authority is a contract, not a prompt
— is provable with zero AI. Live agents make it vivid, not true.

Cut order if time runs short:
1. Privacy inspector (nice-to-have)
2. Live LLM agents → deterministic scripted negotiation
3. Attack panel — **never cut**; it is the demo.

The Daml model is built and tested first, before any AI work begins.

## Deliverables

- [ ] Public repository
- [ ] Presentation deck
- [ ] 3-minute video pitch with demo
- [ ] Link to live product (Vercel)
- [ ] Contracts live on Canton Devnet (not LocalNet/sandbox)

## Time budget

~14h to deadline at time of writing. Reserve the final 3–4h for deck, recording, and
editing — leaving roughly 10h of build.
