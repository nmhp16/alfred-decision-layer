# alfred_ Execution Decision Layer

A prototype that decides how an AI text-message assistant should handle proposed actions: **execute silently**, **execute and notify**, **confirm first**, **ask a clarifying question**, or **refuse/escalate**.

## Quick Start

```bash
npm install
cp .env.example .env.local
# Edit .env.local and add your Groq API key
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Select a preloaded scenario or enter a custom action, then click "Evaluate Decision."

## Architecture

The key architectural decision: **the deterministic engine makes the decision in most cases. The LLM is only called when the code isn't confident enough.**

```
User Input (action + conversation context)
        |
        v
  Signal Computation (TypeScript)
  - 13 signals including temporal analysis + precondition tracking
        |
        v
  Deterministic Decision Engine
  - Confidence scoring (0-1)
  - If confidence >= 0.7 → DECIDE WITHOUT LLM (fast, free, predictable)
  - If confidence < 0.7  → call LLM for nuanced judgment
        |
       / \
      /   \
  [HIGH]  [LOW CONFIDENCE]
     |         |
     |    Groq API Call (Llama 3.3 70B)
     |         |
     |    Code Override Check
     |    - Policy block? → force refuse
     |    - Affects others + silent? → force notify
     |    - Unresolved precondition + execute? → force confirm
     |         |
     v         v
  Final Decision + Full Debug Pipeline
```

This means:
- **Scenarios 1, 2, 3, 4, 7** are decided by code alone (no LLM call, ~5ms)
- **Scenarios 5, 6** go to the LLM because signals are mixed (conflicting instructions + temporal ambiguity)
- **Even when the LLM is called**, the code can override unsafe decisions

## Signals: What and Why

The system computes 13 deterministic signals in code *before* anything else happens.

### Core Signals

| Signal | Type | Why |
|--------|------|-----|
| `intent_resolved` | boolean | Is the action type clear? Ambiguous intent always triggers clarification. |
| `entity_resolved` | boolean | Are referenced entities unambiguous? "The meeting" with 3 meetings = ambiguous. |
| `missing_required_params` | string[] | Each action type has required params. Missing = clarify. |
| `has_prior_explicit_approval` | boolean | Scans conversation for explicit user confirmation. |
| `has_conflicting_prior_instruction` | boolean | "Hold off" followed by "go ahead" — don't treat latest message in isolation. |
| `is_external_facing` | boolean | Sending data outside the organization = higher risk. |
| `is_irreversible` | boolean | Email can't be unsent. Calendar move can be undone. |
| `affects_others` | boolean | Actions involving attendees/recipients should never execute silently. |
| `contains_sensitive_domain` | boolean | Pricing, salary, legal, confidential = extra caution. |
| `risk_score` | number (0-1) | Weighted composite of all signals. |
| `policy_blocked` | boolean | Hard rules that override everything (even LLM). |

### Temporal Signals

| Signal | Type | Why |
|--------|------|-----|
| `hold_recency_minutes` | number\|null | How recently did the user say "hold off"? A hold from 2 hours ago vs 2 minutes ago should be weighted differently. |
| `approval_recency_minutes` | number\|null | How recently did the user approve? If approval is more recent than hold, it's more likely intentional. |

### Precondition Tracking

| Signal | Type | Why |
|--------|------|-----|
| `unresolved_preconditions` | Precondition[] | "Until legal reviews" sets a precondition. The system tracks whether it was resolved in later messages. An unresolved precondition means the user may be jumping ahead. |

### Confidence Scoring

| Signal | Type | Why |
|--------|------|-----|
| `confidence` | number (0-1) | How confident the deterministic engine is. Above 0.7 = skip LLM. Below = call LLM. |
| `confidence_factors` | string[] | Explains what drove the confidence score. Visible in debug panel. |

## LLM vs. Deterministic Code: What Decides What

### Code decides (no LLM needed):
- **Policy violations** → always refuse. Policy is binary — the LLM has nothing to add.
- **Missing information** → always clarify. You can't confirm an action you don't understand.
- **Low-risk, user-only actions** → execute silently. No judgment needed.
- **Low-risk, affects others** → execute and notify. Clear boundary.

### LLM decides (code isn't confident):
- **Conflicting instructions with temporal nuance** — "hold off until legal reviews" then "Yep, send it" 15 minutes later. Did legal actually review? The code detects the conflict and the precondition, but weighing whether the user is being careless vs. informed requires context the code can't parse.
- **Risk assessment in ambiguous contexts** — When the risk score is in the gray zone (0.3-0.5) and signals are mixed.

### Code overrides LLM (safety net):
Even after the LLM responds, the code checks:
- LLM says execute but **policy is blocked** → forced refuse
- LLM says silent but **affects others** → forced notify
- LLM says execute but **unresolved preconditions** exist → forced confirm
- LLM says confirm but **info is missing** → forced clarify

## Prompt Design

The prompt is only built and sent when the deterministic engine has low confidence. It includes:

1. **Why the LLM was called** — confidence score and factors, so the model knows what the code couldn't decide
2. **Decision boundaries in strict order** — the model must evaluate top-to-bottom and stop at the first match
3. **Full conversation with timestamps** — for temporal reasoning
4. **Detected preconditions** — shown explicitly with resolved/unresolved status
5. **Temporal context** — "hold was 15m ago, approval was 0m ago"
6. **All computed signals** — the LLM sees what the code already computed, avoiding redundant analysis
7. **Strict JSON output format** — with `response_format: { type: "json_object" }` for reliable parsing

## Failure Modes

| Failure | System Behavior | Safe Default |
|---------|-----------------|-------------|
| **LLM timeout** (>30s) | Deterministic engine's decision is used | Never silently executes on timeout |
| **Malformed JSON** | Parse error captured, deterministic fallback | Shows error in debug UI |
| **Schema validation failure** | Zod reports specific field errors | Deterministic fallback |
| **Empty response** | Treated as LLM error | Deterministic fallback |
| **Missing critical context** | Signals detect missing params/entities | `ask_clarifying_question` (no LLM needed) |
| **API key missing** | Error returned to frontend | Clear error message |
| **LLM not called** | Deterministic engine handles it | Most scenarios don't need LLM |

**Key difference from a typical chatbot:** When the LLM fails, the system doesn't just say "confirm everything." The deterministic engine makes a real decision based on signals. Policy blocks still refuse. Missing info still clarifies. Low-risk actions still execute. Only genuinely ambiguous cases default to confirmation.

## Scenarios

| # | Name | Category | Expected Decision | LLM Called? |
|---|------|----------|-------------------|-------------|
| 1 | Complete a reminder | Clear | `execute_silently` | No (confidence ~0.9) |
| 2 | Move internal standup | Clear | `execute_and_notify` | No (confidence ~0.85) |
| 3 | Ambiguous reschedule (3 meetings) | Ambiguous | `ask_clarifying_question` | No (confidence ~0.95) |
| 4 | Ambiguous "send the draft" | Ambiguous | `ask_clarifying_question` | No (confidence ~0.95) |
| 5 | External email with pricing/discount | Risky | `confirm_before_execute` | Yes (conflicting instructions) |
| 6 | Conflicting instructions (hold off then send) | Risky | `confirm_before_execute` | Yes (unresolved precondition) |
| 7 | Forward confidential salary data | Policy | `refuse_or_escalate` | No (confidence ~0.99) |
| 8 | Failure simulation | Failure | `confirm_before_execute` (fallback) | Yes (simulated) |

Scenarios 5 and 6 are the interesting ones — they have mixed signals that require the LLM to reason about temporal context and unresolved preconditions.

## How I Would Evolve This System

### As alfred_ gains riskier tools:

1. **Per-tool risk profiles** — Each new capability (file access, payment processing, API calls) gets a registered risk profile. The signal framework already supports this via the `ACTION_TYPES` lookup.

2. **User-specific trust calibration** — Track how often a user's decisions are correct. Power users earn lower confirmation thresholds over time. Store per-user confidence modifiers.

3. **Approval chains** — For high-risk actions (large payments, mass emails), require multi-step approval or escalation to a human manager.

4. **Audit logging** — Every decision (signals, rationale, source) logged immutably. The debug pipeline already captures this data — just needs persistence.

5. **Rate limiting as a signal** — Detect anomalous patterns (10 emails in 2 minutes) as a signal of compromised accounts or confused users.

### What I would build next (6-month roadmap):

**Month 1-2: Foundation**
- Persistent decision logging and analytics dashboard
- A/B testing framework for prompt variations and confidence thresholds
- Real user feedback loop (was this the right decision?)
- Per-user confidence calibration

**Month 3-4: Intelligence**
- Semantic similarity for conflict detection (replace keyword matching with embeddings)
- Multi-turn clarification — if the first question doesn't resolve ambiguity, ask follow-ups
- Precondition resolution via external signals (e.g., check if legal actually replied)
- Learning from user corrections to adjust thresholds

**Month 5-6: Scale**
- Policy engine with configurable rules per organization
- Admin dashboard for setting risk thresholds and policy rules
- Real-time monitoring with alerting for anomalous decision patterns
- Batch decision evaluation for testing new models/prompts against historical scenarios
- Graceful degradation: deterministic engine handles all failures without external dependencies

## What I Chose Not to Build

- **Auth / user management** — Not needed for a prototype. In production, decisions should be scoped per-user.
- **Database** — All scenarios are in-memory. Production would need decision logging.
- **Real integrations** — Actions are mocked. The decision layer is the focus, not the execution layer.
- **Streaming** — The LLM call blocks and returns. Streaming would improve perceived latency but adds complexity.
- **Dark mode** — Visual polish was explicitly deprioritized.

## Deployment

### Vercel (Recommended)

1. Push to GitHub
2. Import the repo at [vercel.com/new](https://vercel.com/new)
3. Add the environment variable `GROQ_API_KEY` in Project Settings > Environment Variables
4. Deploy — Vercel auto-detects Next.js

### Manual

```bash
npm install
npm run build
GROQ_API_KEY=your_key npm start
```

The app runs on `http://localhost:3000` by default.

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GROQ_API_KEY` | Yes | API key from [Groq Console](https://console.groq.com/keys) |

## Tech Stack

- **Next.js 16** (App Router) — Single deployable for API + frontend
- **TypeScript** — Type safety throughout
- **Tailwind CSS** — Minimal styling
- **Llama 3.3 70B** via Groq API — Fast inference with native JSON output mode
- **Zod** — Runtime validation of LLM output
- **Vercel** — Deployment
