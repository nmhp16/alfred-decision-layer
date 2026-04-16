# alfred_ Execution Decision Layer

## Quick Start

```bash
npm install
cp .env.example .env.local
# Add your Groq API key (free at console.groq.com/keys)
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Design Decisions

These are the judgment calls I made where the spec was silent or ambiguous. Each one is a tradeoff.

### Where I drew the boundary between "execute silently" and "execute and notify"

The spec defines three explicit boundaries (clarify, confirm, refuse) but leaves the silent/notify line to us. My rule: **if the action affects other people, notify. If it only affects the user, execute silently.**

Moving a standup affects your coworkers' calendars — they should know it happened even if the risk is near zero. Completing a personal reminder affects nobody but you — no notification needed.

This is a UX judgment: unnecessary confirmations erode trust ("why is alfred_ asking me about everything?"), but silent actions that affect others erode trust even faster ("alfred_ moved my meeting without telling me?"). The boundary is about *who bears the consequence*, not just *how risky it is*.

### Why the code makes most decisions, not the LLM

The naive approach is: compute some context, send it to an LLM, show the result. Anyone can build that in an afternoon. It's also fragile — the LLM is slow, expensive, rate-limited, and non-deterministic.

I split the responsibility differently:
- **Code decides** when signals are unambiguous (policy block → refuse, missing info → clarify, zero-risk → execute). These don't need $0.01 of LLM inference.
- **LLM decides** when signals are genuinely mixed and contextual reasoning matters (conflicting instructions + temporal ambiguity).
- **Code overrides LLM** when the LLM violates safety invariants (ignores policy, executes silently when others are affected, skips unresolved preconditions).

This means the system works even when the LLM is down, and the LLM can't accidentally approve something the rules forbid.

### Why I track conversation state as a state machine

"Yep, send it" means different things depending on where the conversation is:
- After a draft → `APPROVED` (ready to go)
- After "hold off until legal reviews" → `PENDING_RELEASE` (the user might be jumping ahead)
- After a condition was set and later confirmed resolved → `READY` (all clear)

Most systems treat each message independently. Modeling the conversation as a state machine (`IDLE → PROPOSED → DRAFTED → HELD → CONDITION_SET → PENDING_RELEASE`) lets the code reason about the *lifecycle of an action*, not just the latest message. This is what the spec means by "contextual conversation decision problem, not a one-shot classification task."

### Why I track preconditions as first-class objects

When a user says "hold off until legal reviews the pricing language," that's not just a hold — it's a **conditional hold**. The condition ("legal reviews") must be resolved before the hold is lifted. If the user later says "send it" without confirming legal reviewed it, that's the riskiest state the system can be in.

I track these as structured preconditions with resolved/unresolved status. If a precondition is unresolved when the user tries to proceed, the system forces confirmation — even if the LLM says to execute. This is the kind of nuance that a prompt-only system misses entirely.

### Why I built counterfactual analysis

The question "what would happen if X were different?" proves the system understands *causation*, not just *correlation*. For the illustrative scenario (hold off → send it):
- Remove the "hold off" message → decision changes from Confirm to Execute & Notify
- Remove conversation history entirely → decision changes (proving it's contextual, not one-shot)

This is visible in the debug panel. It demonstrates that every signal is load-bearing and the system isn't just pattern-matching keywords.

### Where I simplified

- **Keyword matching for signals, not embeddings.** For 8 scenarios, regex is deterministic and inspectable. Embeddings add latency, cost, and opacity. The right choice for a prototype; the wrong choice at scale. I'd switch to semantic similarity in month 3.
- **No persistent state.** Decisions aren't logged to a database. In production, every decision (signals, rationale, source, overrides) should be logged immutably for audit and learning.
- **No user profiles.** Every user gets the same risk thresholds. In production, a power user who confirms external emails 100 times should earn a lower threshold. Per-user trust calibration is month 1-2 work.
- **No real integrations.** Actions are mocked. The decision layer is the focus, not the execution layer.

---

## Architecture

```
User Input (action + conversation context)
        |
        v
  Signal Computation (13 signals)
  + Conversation State Machine (action lifecycle)
  + Action Reconstruction (what/who/content from context)
        |
        v
  Deterministic Decision Engine
  - Confidence scoring (0-1)
  - High confidence → decide without LLM
  - Low confidence  → call LLM, then check for overrides
        |
        v
  Counterfactual Analysis
  - "What would change if X were different?"
        |
        v
  Final Decision + Full Debug Pipeline (9 sections)
```

## Signals

13 deterministic signals computed in code before anything else:

| Signal | What it detects | Why it matters |
|--------|----------------|----------------|
| `intent_resolved` | Is the action type clear? | Ambiguous intent → always clarify |
| `entity_resolved` | Are referenced entities unambiguous? | "The meeting" with 3 meetings → clarify |
| `missing_required_params` | Required params for action type | Can't send email without recipient |
| `has_conflicting_prior_instruction` | Hold + later approval | Don't treat latest message in isolation |
| `is_external_facing` | Data leaving the organization | External = higher risk |
| `is_irreversible` | Can the action be undone? | Email can't be unsent |
| `affects_others` | Other people impacted? | Never execute silently if others affected |
| `contains_sensitive_domain` | Pricing, salary, legal, etc. | Warrants extra caution |
| `policy_blocked` | Hard policy rules | Overrides everything, including LLM |
| `risk_score` | Weighted composite (0-1) | Summary metric for thresholding |
| `hold_recency_minutes` | How recent was the hold? | "Hold off" 2 min ago vs 2 hours ago |
| `approval_recency_minutes` | How recent was the approval? | Fresh approval after stale hold = more intentional |
| `unresolved_preconditions` | Conditions set but not confirmed resolved | "Until legal reviews" → is it resolved? |

Plus `confidence` (0-1) and `confidence_factors` — the system's self-assessment of how certain it is.

## LLM vs. Code Split

| Situation | Who decides | Why |
|-----------|-------------|-----|
| Policy blocked | Code (always) | Binary — LLM has nothing to add |
| Missing info (entity, params) | Code (always) | Objectively detectable |
| Low-risk, user-only | Code (always) | No judgment needed |
| Low-risk, affects others | Code (usually) | Clear boundary |
| Conflicting instructions + unresolved preconditions | LLM | Temporal nuance + context-dependent reasoning |
| Mixed risk signals (gray zone) | LLM | Genuine judgment call |

**After the LLM responds**, code checks for safety violations and overrides if necessary.

## Failure Modes

| Failure | What happens | Safe default |
|---------|-------------|--------------|
| LLM timeout (>30s) | Deterministic engine decides | Never executes silently |
| Malformed JSON | Parse error → deterministic fallback | Visible in debug UI |
| Missing context | Signals detect missing info | Always clarifies |
| API key missing | Clear error message | No fallback execution |
| LLM not called | Deterministic engine handles it | Most scenarios don't need LLM |

**Core principle:** The system never falls back to `execute_silently` when uncertain. When the LLM fails, the deterministic engine still makes a *real* decision — policy blocks still refuse, missing info still clarifies, low-risk still executes. Only genuinely ambiguous cases default to confirmation.

## Scenarios

| # | Name | Expected | Why | LLM Called? |
|---|------|----------|-----|-------------|
| 1 | Complete a reminder | Execute silently | Low-risk, reversible, user-only | No |
| 2 | Move internal standup | Execute & notify | Low-risk but affects coworkers | No |
| 3 | Ambiguous reschedule | Clarify | "My meeting" but 3 meetings tomorrow | No |
| 4 | Ambiguous "send the draft" | Clarify | 2 drafts exist — which one? | No |
| 5 | External email with discount | Confirm | External + sensitive + conflicting instructions | Yes |
| 6 | Conflicting hold → send | Confirm | Unresolved precondition ("until legal reviews") | Yes |
| 7 | Forward salary data externally | Refuse | Policy: confidential data can't go external | No |
| 8 | Failure simulation | Execute & notify (fallback) | Demonstrates graceful degradation — deterministic engine makes a real decision, not a blind "confirm everything" | Simulated |

Scenario 6 is the illustrative example from the challenge. The counterfactual analysis for this scenario shows that removing the "hold off" message changes the decision — proving the system reasons about conversation history, not just the latest message.

## How I Would Evolve This

### Next 6 months

**Month 1-2:** Per-user trust calibration (users who are consistently right earn lower thresholds), persistent decision logging, A/B testing for confidence thresholds, user feedback loop ("was this the right call?").

**Month 3-4:** Replace keyword matching with embeddings for semantic conflict detection, multi-turn clarification (follow-up if first question doesn't resolve), precondition resolution via external signals (check if legal actually replied in email).

**Month 5-6:** Configurable policy engine per organization, admin dashboard for risk thresholds, real-time monitoring for anomalous patterns, batch evaluation for testing new models against historical decisions.

### As alfred_ gains riskier tools

Each new capability (file access, payments, API calls) needs a registered risk profile. The signal framework supports this — `ACTION_TYPES` already maps action types to `{ irreversible, externalFacing, requiredParams }`. New tools extend this registry.

For high-risk actions (large payments, mass emails): approval chains, not just user confirmation. Rate limiting as a signal — 10 emails in 2 minutes suggests a compromised account or confused user.

## What I Chose Not to Build (and why)

- **Auth** — Decisions should be per-user in production. Not needed to demonstrate the decision logic.
- **Database** — Decision logging needs persistence. In-memory is fine for a prototype.
- **Real integrations** — The decision layer is the interesting problem, not the execution layer.
- **Streaming** — Would improve perceived latency. Adds complexity without demonstrating judgment.
- **Embeddings** — Keyword matching is deterministic and inspectable. Wrong at scale, right for a prototype.

## Deployment

### Vercel

1. Push to GitHub
2. Import at [vercel.com/new](https://vercel.com/new)
3. Add `GROQ_API_KEY` in Environment Variables
4. Deploy

### Manual

```bash
npm install && npm run build && GROQ_API_KEY=your_key npm start
```

## Tech Stack

Next.js 16 (App Router) | TypeScript | Tailwind CSS | Llama 3.3 70B via Groq | Zod | Vercel
