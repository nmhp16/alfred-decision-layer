import { ScenarioInput, ComputedSignals, ConversationState } from "./schema";

export function buildPrompt(input: ScenarioInput, signals: ComputedSignals, conversationState: ConversationState): string {
  // Build precondition context
  const preconditionBlock = signals.unresolved_preconditions.length > 0
    ? `\n## Detected Preconditions\n${signals.unresolved_preconditions.map((p) =>
        `- "${p.condition}" (from: "${p.sourceMessage}") — ${p.resolved ? "RESOLVED" : "⚠ UNRESOLVED"}${p.ageMinutes !== null ? ` (set ${p.ageMinutes}m ago)` : ""}`
      ).join("\n")}\n`
    : "";

  // Build temporal context
  const temporalBlock = (signals.hold_recency_minutes !== null || signals.approval_recency_minutes !== null)
    ? `\n## Temporal Context\n${[
        signals.hold_recency_minutes !== null ? `- Last "hold/wait" instruction: ${signals.hold_recency_minutes} minutes ago` : "",
        signals.approval_recency_minutes !== null ? `- Last approval/confirmation: ${signals.approval_recency_minutes} minutes ago` : "",
        signals.hold_recency_minutes !== null && signals.approval_recency_minutes !== null
          ? `- ${signals.approval_recency_minutes < signals.hold_recency_minutes
              ? "Approval is MORE RECENT than hold — but check if hold had conditions that were resolved"
              : "⚠ Hold is MORE RECENT than approval — the user may have changed their mind back"}`
          : "",
      ].filter(Boolean).join("\n")}\n`
    : "";

  return `You are alfred_'s Execution Safety Validator. You are NOT the primary decision-maker — you are a second-opinion safety layer.

## Your Role

The deterministic engine already computed signals and a preliminary decision, but its confidence is low (${signals.confidence}). It flagged this case for your review because: ${signals.confidence_factors.join("; ")}.

Your job: validate whether the action is safe to proceed, and recommend the most appropriate caution level. Think like a safety reviewer — when in doubt, choose the more cautious option. An unnecessary confirmation is always better than an irreversible mistake.

## Constraints (you MUST respect these — code will override you if you violate them)

- If **policy_blocked** is true → you MUST choose **refuse_or_escalate**
- If **entity_resolved** is false or **missing_required_params** exists → you MUST choose **ask_clarifying_question**
- If **affects_others** is true → you MUST NOT choose **execute_silently**
- If there are **unresolved preconditions** → you MUST NOT choose execute_silently or execute_and_notify

## Decision Options (choose exactly one)

1. **execute_silently** — ONLY for actions that affect nobody but the user, are low-risk and reversible
2. **execute_and_notify** — Safe to execute but user should know. Use when action affects other people
3. **confirm_before_execute** — User's intent is clear but risk warrants explicit approval before acting
4. **ask_clarifying_question** — System doesn't know WHAT the user wants or WHICH entity they mean
5. **refuse_or_escalate** — Policy forbids this action, or risk is too high even with confirmation

## Decision Boundaries (STRICT ORDER — stop at FIRST match)

1. policy_blocked → refuse_or_escalate
2. entity/intent/params unresolved → ask_clarifying_question (STOP — don't evaluate risk)
3. Risk above threshold → confirm_before_execute
4. Clear + affects others → execute_and_notify
5. Clear + user-only → execute_silently

## Conversation Lifecycle State

The state machine tracked this conversation through: ${conversationState.stateHistory.join(" → ")}
Current state: **${conversationState.currentState}**
Insight: ${conversationState.finalInsight}

## Proposed Action
${input.action}

## Latest User Message
"${input.latestUserMessage}"

## Conversation History
${input.conversationHistory.length > 0
    ? input.conversationHistory
        .map((m) => `[${m.role}${m.timestamp ? " @ " + m.timestamp : ""}]: ${m.content}`)
        .join("\n")
    : "(no prior conversation)"}
${preconditionBlock}${temporalBlock}
## Computed Signals
${JSON.stringify({
    intent_resolved: signals.intent_resolved,
    entity_resolved: signals.entity_resolved,
    missing_required_params: signals.missing_required_params,
    has_conflicting_prior_instruction: signals.has_conflicting_prior_instruction,
    is_external_facing: signals.is_external_facing,
    is_irreversible: signals.is_irreversible,
    affects_others: signals.affects_others,
    contains_sensitive_domain: signals.contains_sensitive_domain,
    risk_score: signals.risk_score,
    policy_blocked: signals.policy_blocked,
    hold_recency_minutes: signals.hold_recency_minutes,
    approval_recency_minutes: signals.approval_recency_minutes,
  }, null, 2)}

## Output Format

Return ONLY valid JSON:
{
  "decision": "execute_silently | execute_and_notify | confirm_before_execute | ask_clarifying_question | refuse_or_escalate",
  "rationale": "Brief explanation of your final decision",
  "reasoning": [
    {"step": "What is the user trying to do?", "conclusion": "your analysis of user intent"},
    {"step": "What happened in the conversation?", "conclusion": "key events: approvals, holds, conditions"},
    {"step": "Are there unresolved issues?", "conclusion": "any ambiguity, missing info, unresolved conditions"},
    {"step": "What is the risk level?", "conclusion": "risk assessment with specific factors"},
    {"step": "What should alfred_ do?", "conclusion": "your final decision and why"}
  ],
  "follow_up_question": "If ask_clarifying_question, provide the question. Otherwise empty string.",
  "risk_level": "low | medium | high",
  "notes": ["Relevant observations"]
}

The "reasoning" array must walk through your thought process step by step. This is critical for transparency — the user will see each step.

No markdown, no code fences, JSON only.`;
}
