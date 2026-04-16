import { ScenarioInput, ComputedSignals } from "./schema";

export function buildPrompt(input: ScenarioInput, signals: ComputedSignals): string {
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

  return `You are alfred_'s Execution Decision Layer. The deterministic engine has LOW CONFIDENCE on this case and needs your judgment. Focus on nuances the rules can't capture.

## Why You Were Called
The system's deterministic engine computed signals but confidence is ${signals.confidence} (threshold: 0.7). Factors: ${signals.confidence_factors.join("; ")}.

Your job: weigh the signals against the full conversation context and make a nuanced judgment call.

## Decision Options (choose exactly one)

1. **execute_silently** — Affects ONLY the user, low-risk, reversible. Examples: marking a reminder done, saving a draft.
2. **execute_and_notify** — Clear, low-risk but affects other people. Execute and tell user after.
3. **confirm_before_execute** — Intent is resolved but risk warrants explicit approval.
4. **ask_clarifying_question** — Intent, entity, or key parameters are unresolved.
5. **refuse_or_escalate** — Policy violation or risk too high even after clarification.

## Decision Boundaries (STRICT ORDER — stop at FIRST match)

1. If **policy_blocked** → **refuse_or_escalate**. No exceptions.
2. If **entity_resolved** = false, OR **missing_required_params** non-empty, OR **intent_resolved** = false → **ask_clarifying_question**. STOP. Do NOT evaluate risk.
3. If intent + entity resolved but risk is above threshold (external, irreversible, sensitive, conflicting instructions, unresolved preconditions) → **confirm_before_execute**.
4. If clear, low-risk, **affects_others** = true → **execute_and_notify**.
5. If low-risk, reversible, **affects_others** = false → **execute_silently**.

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

## User State
${input.userState ? JSON.stringify(input.userState, null, 2) : "(no user state provided)"}
${preconditionBlock}${temporalBlock}
## Computed Signals
${JSON.stringify(signals, null, 2)}

## Signal Interpretation
- intent_resolved: ${signals.intent_resolved ? "Clear" : "⚠ UNCLEAR"}
- entity_resolved: ${signals.entity_resolved ? "Unambiguous" : "⚠ AMBIGUOUS"}
- missing_required_params: ${signals.missing_required_params.length === 0 ? "None" : "⚠ Missing: " + signals.missing_required_params.join(", ")}
- has_conflicting_prior_instruction: ${signals.has_conflicting_prior_instruction ? "⚠ CONFLICTING — hold AND approval found" : "No conflicts"}
- unresolved_preconditions: ${signals.unresolved_preconditions.filter(p => !p.resolved).length > 0 ? "⚠ " + signals.unresolved_preconditions.filter(p => !p.resolved).map(p => p.condition).join(", ") : "None"}
- is_external_facing: ${signals.is_external_facing ? "⚠ External" : "Internal"}
- is_irreversible: ${signals.is_irreversible ? "⚠ Cannot undo" : "Reversible"}
- affects_others: ${signals.affects_others ? "⚠ Impacts other people" : "User only"}
- contains_sensitive_domain: ${signals.contains_sensitive_domain ? "⚠ Sensitive" : "No"}
- risk_score: ${signals.risk_score}
- policy_blocked: ${signals.policy_blocked ? "🚫 BLOCKED" : "No"}

## Output Format

Return ONLY valid JSON:
{
  "decision": "execute_silently | execute_and_notify | confirm_before_execute | ask_clarifying_question | refuse_or_escalate",
  "rationale": "Brief explanation referencing signals and conversation context",
  "follow_up_question": "If ask_clarifying_question, provide the question. Otherwise empty string.",
  "risk_level": "low | medium | high",
  "notes": ["Relevant observations"]
}

No markdown, no code fences, JSON only.`;
}
