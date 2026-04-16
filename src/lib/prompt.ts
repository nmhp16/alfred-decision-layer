import { ScenarioInput, ComputedSignals } from "./schema";

export function buildPrompt(input: ScenarioInput, signals: ComputedSignals): string {
  return `You are alfred_'s Execution Decision Layer. Your job is to decide how alfred_ should handle a proposed action given the full conversation context and computed signals.

## Decision Options (choose exactly one)

1. **execute_silently** — Low-risk, reversible, clearly authorized. The user would expect this to just happen.
2. **execute_and_notify** — Clear, routine, low/medium-risk. Execute and tell the user afterward.
3. **confirm_before_execute** — Intent is resolved but risk is above the silent threshold. Ask for explicit confirmation.
4. **ask_clarifying_question** — Intent, entity, or key parameters are unresolved. Need more information.
5. **refuse_or_escalate** — Policy disallows the action, or risk/uncertainty is too high even after clarification.

## Decision Boundaries

- Ask a clarifying question when intent, entity, or key parameters are unresolved.
- Confirm before executing when intent is resolved but risk is above the silent execution threshold.
- Refuse/escalate when policy disallows the action, or risk or uncertainty remains too high.
- Execute silently ONLY for low-risk, reversible, clearly authorized actions.
- Execute and notify for clear low/medium-risk routine actions.

## CRITICAL: Context-Aware Reasoning

This is a CONTEXTUAL CONVERSATION decision — NOT a one-shot classification. You MUST:
- Consider the FULL conversation history, not just the latest message
- Detect conflicting instructions (e.g., "hold off" followed by "send it")
- Identify when prior conditions (like a legal review) have NOT been confirmed as resolved
- Weigh prior explicit approvals and whether they still apply given intervening messages

## Proposed Action
${input.action}

## Latest User Message
"${input.latestUserMessage}"

## Conversation History
${input.conversationHistory.length > 0
    ? input.conversationHistory
        .map((m) => `[${m.role}${m.timestamp ? " @ " + m.timestamp : ""}]: ${m.content}`)
        .join("\n")
    : "(no prior conversation)"
  }

## User State
${input.userState ? JSON.stringify(input.userState, null, 2) : "(no user state provided)"}

## Computed Signals (from deterministic analysis)
${JSON.stringify(signals, null, 2)}

## Signal Interpretation Guide
- intent_resolved: ${signals.intent_resolved ? "Action type is clear" : "⚠ Action type is unclear"}
- entity_resolved: ${signals.entity_resolved ? "Referenced entities are unambiguous" : "⚠ Ambiguous entity references detected"}
- missing_required_params: ${signals.missing_required_params.length === 0 ? "All required params present" : "⚠ Missing: " + signals.missing_required_params.join(", ")}
- has_prior_explicit_approval: ${signals.has_prior_explicit_approval ? "User previously approved" : "No prior explicit approval found"}
- has_conflicting_prior_instruction: ${signals.has_conflicting_prior_instruction ? "⚠ CONFLICTING INSTRUCTIONS detected — user said to hold/stop AND later said to proceed" : "No conflicting instructions"}
- is_external_facing: ${signals.is_external_facing ? "⚠ Action sends data outside the organization" : "Internal action only"}
- is_irreversible: ${signals.is_irreversible ? "⚠ Action cannot be undone" : "Action is reversible"}
- contains_sensitive_domain: ${signals.contains_sensitive_domain ? "⚠ Sensitive content detected (pricing, legal, confidential, etc.)" : "No sensitive content detected"}
- risk_score: ${signals.risk_score} (0=safe, 1=maximum risk)
- policy_blocked: ${signals.policy_blocked ? "🚫 POLICY VIOLATION — this action is blocked by policy" : "No policy violations"}

## Output Format

Return ONLY valid JSON matching this exact schema:
{
  "decision": "execute_silently | execute_and_notify | confirm_before_execute | ask_clarifying_question | refuse_or_escalate",
  "rationale": "Brief explanation of your reasoning, referencing specific signals and context",
  "follow_up_question": "If decision is ask_clarifying_question, provide the question. Otherwise empty string.",
  "risk_level": "low | medium | high",
  "notes": ["Array of relevant observations about the context"]
}

Return JSON only. No markdown, no code fences, no explanation outside the JSON.`;
}
