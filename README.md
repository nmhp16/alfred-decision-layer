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

These are the judgment calls I made where the spec was silent or ambiguous.

### Where I drew the boundary between "execute silently" and "execute and notify"

The spec defines three explicit boundaries (clarify, confirm, refuse) but leaves the silent/notify line to us. My rule: **if the action affects other people, notify. If it only affects the user, execute silently.**

Moving a standup affects your coworkers' calendars — they should know it happened even if the risk is near zero. Completing a personal reminder affects nobody but you — no notification needed.

This is a UX judgment: unnecessary confirmations erode trust ("why is alfred_ asking me about everything?"), but silent actions that affect others erode trust even faster ("alfred_ moved my meeting without telling me?"). The boundary is about *who bears the consequence*, not just *how risky it is*.

### Why the LLM classifies, but code enforces

The LLM is good at understanding intent ("I'm done with groceries" = complete a reminder). Code is good at enforcing rules (confidential data + external recipient = always refuse).

The split:
- **LLM classifies** the action: what type, who's affected, what's the risk, what should alfred_ do
- **Code enforces** safety rules on top: policy blocks, state machine constraints, precondition checks
- **Code overrides LLM** when it violates invariants (tries to execute when policy blocks, or when state machine says HELD)
- **Code falls back** to regex-based signals when the LLM is unavailable

This means the LLM can never approve something the rules forbid, and the system still works when the LLM is down.

### Why I track conversation state as a state machine

"Yep, send it" means different things depending on where the conversation is:
- After a draft → `APPROVED` (ready to go)
- After "hold off until legal reviews" → `PENDING_RELEASE` (the user might be jumping ahead)
- After a condition was set and later confirmed resolved → `READY` (all clear)

Most systems treat each message independently. Modeling the conversation as a state machine (`IDLE → PROPOSED → DRAFTED → HELD → CONDITION_SET → PENDING_RELEASE`) lets the code reason about the *lifecycle of an action*, not just the latest message. This is what the spec means by "contextual conversation decision problem, not a one-shot classification task."

The state machine processes messages incrementally — each step updates the state and builds a running understanding. The debug panel shows how the system's understanding evolved message by message.

### Why I track preconditions as first-class objects

When a user says "hold off until legal reviews the pricing language," that's not just a hold — it's a **conditional hold**. The condition ("legal reviews") must be resolved before the hold is lifted. If the user later says "send it" without confirming legal reviewed it, that's the riskiest state the system can be in.

I track these as structured preconditions with resolved/unresolved status. If a precondition is unresolved when the user tries to proceed, the system forces confirmation — even if the LLM says to execute.

### Why I built counterfactual analysis

The question "what would happen if X were different?" proves the system understands *causation*, not just *correlation*. For the illustrative scenario (hold off → send it):
- Remove the "hold off" message → decision changes from Confirm to Execute & Notify
- Remove conversation history entirely → decision changes (proving it's contextual, not one-shot)

This is visible in the debug panel for every scenario.

### Where I simplified

- **No persistent state.** Decisions aren't logged to a database. In production, every decision should be logged immutably for audit and learning.
- **No user profiles.** Every user gets the same risk thresholds. In production, power users should earn lower thresholds over time.
- **No real integrations.** Actions are mocked. The decision layer is the focus, not the execution layer.
- **Regex-based fallback signals.** When the LLM is unavailable, the system falls back to keyword matching for action classification. This is reliable for binary checks (policy, ambiguity) but fragile for intent understanding. At scale, I'd replace this with embeddings or a lightweight classifier.

---

## What Signals the System Uses, and Why

13 deterministic signals computed in code before the LLM sees anything:

| Signal | What it detects | Why it matters |
|--------|----------------|----------------|
| `intent_resolved` | Is the action type clear? | Ambiguous intent → always clarify |
| `entity_resolved` | Are referenced entities unambiguous? | "The meeting" with 3 meetings → clarify |
| `missing_required_params` | Required params for action type | Can't send email without recipient |
| `has_conflicting_prior_instruction` | Hold + later approval in history | Don't treat latest message in isolation |
| `is_external_facing` | Data leaving the organization | External = higher risk |
| `is_irreversible` | Can the action be undone? | Email can't be unsent |
| `affects_others` | Other people impacted? | Never execute silently if others affected |
| `contains_sensitive_domain` | Pricing, salary, legal, etc. | Warrants extra caution |
| `policy_blocked` | Hard policy rules violated | Overrides everything, including LLM |
| `risk_score` | Weighted composite (0-1) | Summary metric for thresholding |
| `hold_recency_minutes` | How recent was the hold? | "Hold off" 2 min ago vs 2 hours ago matters |
| `approval_recency_minutes` | How recent was the approval? | Fresh approval after stale hold = more intentional |
| `unresolved_preconditions` | Conditions set but not confirmed resolved | "Until legal reviews" — was it resolved? |

Plus `confidence` (0-1) and `confidence_factors` — the system's self-assessment of how certain it is in its own classification.

## How Responsibility Is Split Between LLM and Code

| Role | Who | Why |
|------|-----|-----|
| **Classify intent** | LLM | Understanding natural language is what LLMs do best |
| **Assess contextual risk** | LLM | Risk depends on full conversation context, not just keywords |
| **Recommend decision** | LLM | Nuanced judgment weighing multiple factors |
| **Produce reasoning chain** | LLM | Step-by-step explanation visible in UI |
| **Block policy violations** | Code (always) | Binary rules. No judgment needed, no exceptions |
| **Detect missing info** | Code (always) | Ambiguous references and missing params are objectively detectable |
| **Track conversation lifecycle** | Code (state machine) | Deterministic state transitions, not LLM interpretation |
| **Override unsafe LLM output** | Code (always) | Policy blocks, state machine constraints, precondition checks |
| **Fallback when LLM fails** | Code | Regex signals provide best-effort decision when LLM is unavailable |

**What the model decides:** The LLM recommends one of the 5 decisions with a rationale and step-by-step reasoning. It sees the computed signals, conversation state, and full history.

**What code computes deterministically:** Policy violations, entity ambiguity, precondition tracking, temporal analysis, confidence scoring, state machine transitions. Code also enforces overrides — if the LLM ignores a policy block or tries to execute during a HELD state, code corrects it.

## Prompt Design

The LLM is framed as a **safety validator**, not a primary decision-maker. The prompt:

1. **States the role explicitly** — "You are alfred_'s Execution Safety Validator. You are a second-opinion safety layer."
2. **Lists hard constraints** the LLM must respect — policy blocks, missing info, affects-others. Code will override violations anyway, but stating them upfront reduces the need for overrides.
3. **Provides decision boundaries in strict order** — evaluate top-to-bottom, stop at first match. This prevents the LLM from skipping clarification to jump to risk assessment.
4. **Includes the conversation lifecycle state** — the LLM sees `IDLE → PROPOSED → DRAFTED → HELD → PENDING_RELEASE` so it knows where the action is in its lifecycle.
5. **Shows detected preconditions** with resolved/unresolved status and age in minutes.
6. **Shows temporal context** — "hold was 140m ago, approval was 0m ago."
7. **Requires structured reasoning** — the LLM outputs a `reasoning` array with step-by-step analysis, not just a verdict.
8. **Uses JSON mode** — `response_format: { type: "json_object" }` for reliable parsing.

Key design choice: the prompt tells the LLM "when in doubt, choose the more cautious option." An unnecessary confirmation is always better than an irreversible mistake.

## Expected Failure Modes

| Failure | What happens | Safe default |
|---------|-------------|--------------|
| **LLM timeout** (>30s) | Deterministic engine decides using regex signals | Never executes silently on timeout |
| **Malformed JSON** | Parse error captured, deterministic fallback | Visible in debug UI |
| **Schema validation failure** | Zod reports specific field errors | Falls back to deterministic |
| **Missing critical context** | Signals detect missing params/entities | Always asks clarifying question |
| **API key missing** | Clear error message | No fallback execution |
| **LLM rate limited** | Concise error message, deterministic fallback | Same as timeout behavior |

**Core safety principle:** The system never falls back to `execute_silently` when uncertain. When the LLM fails, the deterministic engine makes a *real* decision — policy blocks still refuse, missing info still clarifies. Only genuinely ambiguous cases default to confirmation.

The failure simulation scenario (scenario 8) makes this visible in the UI — toggle between timeout and malformed JSON to see the fallback behavior with full debug transparency.

## Scenarios

| # | Name | Category | Expected | Why |
|---|------|----------|----------|-----|
| 1 | Complete a reminder | Clear | Execute silently | Low-risk, reversible, user-only |
| 2 | Move internal standup | Clear | Execute & notify | Low-risk but affects coworkers' calendars |
| 3 | Ambiguous reschedule | Ambiguous | Clarify | "My meeting" but 3 meetings tomorrow — which one? |
| 4 | Ambiguous "send the draft" | Ambiguous | Clarify | 2 drafts exist — which one? |
| 5 | External email with discount | Risky | Confirm | External + sensitive + unresolved precondition (legal review) |
| 6 | Conflicting hold → send | Risky | Confirm | User said "hold for legal" then "send it" — did legal review? |
| 7 | Forward salary data externally | Policy | Refuse | Confidential data + external recipient = policy violation |
| 8 | Failure simulation | Failure | Fallback decision | Demonstrates graceful degradation when LLM fails |

Scenario 6 is the illustrative example from the challenge. The counterfactual analysis shows that removing the "hold off" message changes the decision — proving the system reasons about conversation history, not just the latest message.

## How I Would Evolve This System

### As alfred_ gains riskier tools

Each new capability (file access, payments, API calls) needs a registered risk profile. The signal framework supports this — `ACTION_TYPES` maps action types to `{ irreversible, externalFacing, requiredParams }`. New tools extend this registry.

For high-risk actions (large payments, mass emails): approval chains, not just user confirmation. Rate limiting as a signal — 10 emails in 2 minutes suggests a compromised account or confused user.

### What I would build next (6-month roadmap)

**Month 1-2: Foundation**
- Per-user trust calibration — users who are consistently right earn lower confirmation thresholds
- Persistent decision logging for audit and analytics
- A/B testing for confidence thresholds and prompt variations
- User feedback loop ("was this the right call?")

**Month 3-4: Intelligence**
- Replace keyword matching with embeddings for semantic conflict detection
- Multi-turn clarification — follow up if first question doesn't resolve ambiguity
- Precondition resolution via external signals (check if legal actually replied in email)
- Learning from user corrections to adjust thresholds

**Month 5-6: Scale**
- Configurable policy engine per organization
- Admin dashboard for risk thresholds and policy rules
- Real-time monitoring for anomalous decision patterns
- Batch evaluation for testing new models against historical decisions

## What I Chose Not to Build

- **Auth / user profiles** — Decisions should be per-user in production. Not needed to demonstrate the decision logic.
- **Database** — Decision logging needs persistence. In-memory is fine for a prototype.
- **Real integrations** — The decision layer is the interesting problem, not the execution layer.
- **Streaming** — Would improve perceived latency. Adds complexity without demonstrating judgment.
- **Embeddings** — Keyword matching is deterministic and inspectable for a prototype. At scale, I'd switch to semantic similarity.

## Deployment

### Vercel (Recommended)

1. Push to GitHub
2. Import at [vercel.com/new](https://vercel.com/new)
3. Add `GROQ_API_KEY` in Environment Variables
4. Deploy — Vercel auto-detects Next.js

### Manual

```bash
npm install && npm run build && GROQ_API_KEY=your_key npm start
```

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GROQ_API_KEY` | Yes | Free API key from [Groq Console](https://console.groq.com/keys) |

## Tech Stack

- **Next.js 16** (App Router) — Single deployable for API + frontend
- **TypeScript** — Type safety throughout the pipeline
- **Tailwind CSS** — Minimal styling
- **Llama 3.3 70B** via Groq API — Fast inference with native JSON output mode
- **Zod** — Runtime validation of LLM output
- **Vercel** — Deployment
