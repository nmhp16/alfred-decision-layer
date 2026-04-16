# alfred_ Execution Decision Layer

A minimal full-stack prototype that decides how an AI text-message assistant should handle proposed actions: **execute silently**, **execute and notify**, **confirm first**, **ask a clarifying question**, or **refuse/escalate**.

## Quick Start

```bash
npm install
cp .env.example .env.local
# Edit .env.local and add your Groq API key
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Select a preloaded scenario or enter a custom action, then click "Evaluate Decision."

## Architecture

```
User Input (action + conversation context)
        |
        v
  Deterministic Signal Computation (TypeScript)
        |
        v
  Prompt Assembly (signals + context --> structured prompt)
        |
        v
  Groq API Call — Llama 3.3 70B (with 30s timeout)
        |
        v
  Zod Validation + Safe Fallback
        |
        v
  Decision + Full Debug Pipeline
```

## Signals: What and Why

The system computes 11 deterministic signals in code *before* the LLM sees anything. This separation is deliberate: signals that can be computed reliably with rules should be, so the LLM focuses on nuanced judgment rather than pattern matching.

| Signal | Type | Why |
|--------|------|-----|
| `intent_resolved` | boolean | Detects if the action type is clear. Ambiguous intent should always trigger clarification, not guesswork. |
| `entity_resolved` | boolean | Checks if referenced entities (meetings, drafts, people) are unambiguous. "The meeting" with 3 meetings tomorrow = ambiguous. |
| `missing_required_params` | string[] | Each action type has required params. Sending an email without a recipient is incomplete, not unclear. |
| `has_prior_explicit_approval` | boolean | Scans conversation history for explicit user confirmation. Prior approval affects risk assessment. |
| `has_conflicting_prior_instruction` | boolean | Detects when a user said "hold off" and later said "go ahead" — the system should not treat the latest message in isolation. |
| `is_external_facing` | boolean | Actions that send data outside the organization carry inherently higher risk. |
| `is_irreversible` | boolean | Sending an email can't be undone. Moving a calendar event can. This distinction matters for silent execution thresholds. |
| `affects_others` | boolean | Actions involving attendees, recipients, or shared resources should never execute silently — other people are impacted. |
| `contains_sensitive_domain` | boolean | Keywords like pricing, salary, legal, confidential flag content that warrants extra caution. |
| `risk_score` | number (0-1) | Weighted composite of all above signals. Gives the LLM a single summary metric alongside the individual signals. |
| `policy_blocked` | boolean | Hard policy rules — e.g., confidential internal data cannot be sent to external parties. This overrides LLM judgment. |

## LLM vs. Deterministic Code Split

**Code handles:**
- Action type classification (pattern matching on action text)
- Required parameter checking (lookup table per action type)
- Conversation history scanning (regex for hold/approval patterns)
- External-facing detection (keyword matching)
- Risk score computation (weighted formula)
- Policy enforcement (hard rules that override LLM)
- Output validation (Zod schema)
- Fallback behavior (safe defaults on failure)

**The LLM handles:**
- Weighing the computed signals against the full conversational context
- Judging subtle cases (e.g., "Yep, send it" after "hold off until legal reviews" — did legal actually review?)
- Generating a human-readable rationale
- Producing a contextually appropriate follow-up question when needed
- Capturing nuances that rules can't (tone, implicit urgency, organizational context)

**Why this split:** Deterministic signals are cheap, fast, and predictable. They constrain the LLM's decision space so it focuses on judgment rather than classification. The LLM is expensive and slow but excels at reasoning about ambiguous situations. By pre-computing signals, we also get a transparent audit trail — you can see exactly what the code computed before the LLM weighed in.

## Prompt Design

The prompt is structured in sections:

1. **Role definition** — "You are alfred_'s execution decision layer"
2. **Decision options with definitions** — Clear boundaries for each of the 5 outcomes
3. **Decision boundaries** — Explicit rules for when to use each option (matching the product spec)
4. **Context-awareness instruction** — Explicit instruction to consider FULL conversation history, not just the latest message. This is critical — the challenge specifically asks for contextual conversation decisions.
5. **Action + conversation history** — The full input, chronologically ordered with timestamps
6. **Computed signals with interpretation guide** — Each signal is explained in context (e.g., "CONFLICTING INSTRUCTIONS detected — user said to hold/stop AND later said to proceed")
7. **Output format** — Strict JSON schema, no markdown/fences

Key design choices:
- Signals are provided as structured data *and* with human-readable interpretations, so the model understands both the data and its significance
- The prompt emphasizes contextual reasoning multiple times because the default LLM behavior tends toward one-shot classification
- Policy-blocked is flagged with a strong emoji marker to ensure the model respects hard policy rules

## Failure Modes

| Failure | System Behavior | Safe Default |
|---------|-----------------|-------------|
| **LLM timeout** (>30s) | Fallback to `confirm_before_execute` | Never silently executes on timeout |
| **Malformed JSON** | Parse error captured, fallback applied | Shows parse error in debug UI, defaults to confirmation |
| **Schema validation failure** | Zod reports specific field errors | Defaults to confirmation with error details |
| **Empty response** | Treated as LLM error | Defaults to confirmation |
| **Missing critical context** | Signals detect missing params/entities | Falls back to `ask_clarifying_question` |
| **API key missing** | Error returned to frontend | Clear error message, no fallback execution |

The LLM is called with `response_format: { type: "json_object" }` which instructs Groq to return valid JSON natively, reducing parse failures.

**Rule-based fallback engine:** When the LLM is unavailable (timeout, rate limit, API error), the system does not blindly default to "confirm." Instead, it uses the pre-computed signals to make a real decision via deterministic rules:

- `policy_blocked` → refuse/escalate
- Missing intent, entity, or params → ask clarifying question (with a context-aware question)
- Conflicting prior instructions → confirm
- Risk score >= 0.4 → confirm (with risk factors listed)
- Low risk + internal + reversible → execute silently
- Everything else → execute and notify

This means the system degrades gracefully — most scenarios still get the *correct* decision even without the LLM. The LLM adds nuance and rationale quality, but the signals carry the core logic.

**Core safety principle:** The system *never* falls back to `execute_silently` when it has no signals. When uncertain, it always errs toward confirmation or clarification.

The failure simulation scenario (scenario 8) makes this visible in the UI — you can toggle between timeout and malformed JSON to see the fallback behavior with full debug pipeline transparency.

## Scenarios

| # | Name | Category | Expected Decision |
|---|------|----------|-------------------|
| 1 | Complete a reminder | Clear | `execute_silently` |
| 2 | Move internal standup | Clear | `execute_and_notify` |
| 3 | Ambiguous reschedule (3 meetings) | Ambiguous | `ask_clarifying_question` |
| 4 | Ambiguous "send the draft" | Ambiguous | `ask_clarifying_question` |
| 5 | External email with pricing/discount | Risky | `confirm_before_execute` |
| 6 | Conflicting instructions (hold off then send) | Risky | `confirm_before_execute` |
| 7 | Forward confidential salary data externally | Policy | `refuse_or_escalate` |
| 8 | Failure simulation | Failure | `confirm_before_execute` (fallback) |

Scenario 6 is the illustrative example from the challenge: the system detects conflicting prior instructions and does not treat "Yep, send it" in isolation.

## How I Would Evolve This System

### As alfred_ gains riskier tools:

1. **Per-tool risk profiles** — Each new capability (file access, payment processing, API calls) should have a registered risk profile that feeds into signal computation. The signal framework already supports this via the `ACTION_TYPES` lookup.

2. **User-specific trust calibration** — Track how often a user's "go ahead" turns out to be correct. Power users who rarely make mistakes could earn lower confirmation thresholds over time.

3. **Approval chains** — For high-risk actions (large payments, mass emails), require multi-step approval or escalation to a human manager.

4. **Audit logging** — Every decision, including signals and rationale, should be logged immutably. The debug pipeline already captures this data.

5. **Rate limiting** — Detect anomalous patterns (10 emails in 2 minutes) as a signal of compromised accounts or confused users.

### What I would build next (6-month roadmap):

**Month 1-2: Foundation**
- Persistent decision logging and analytics dashboard
- A/B testing framework for prompt variations and threshold tuning
- Real user feedback loop (was this the right decision?)

**Month 3-4: Intelligence**
- User preference learning — track patterns like "Sarah always confirms external emails" and adapt thresholds
- Semantic similarity for conflict detection (replace keyword matching with embeddings)
- Multi-turn clarification — if the first clarifying question doesn't resolve ambiguity, ask follow-ups

**Month 5-6: Scale**
- Policy engine with configurable rules per organization
- Admin dashboard for setting risk thresholds and policy rules
- Real-time monitoring with alerting for anomalous decision patterns
- Batch decision evaluation for testing new models/prompts against historical scenarios

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
