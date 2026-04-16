import { DecisionOutput, ComputedSignals, DecisionSource, ConversationState } from "./schema";

const CONFIDENCE_THRESHOLD = 0.97;

export interface DeterministicResult {
  decision: DecisionOutput;
  source: DecisionSource;
  shouldCallLLM: boolean;
}

export function deterministicDecision(signals: ComputedSignals): DeterministicResult {
  // Rule 1: Policy block → refuse
  if (signals.policy_blocked) {
    return {
      decision: {
        decision: "refuse_or_escalate",
        rationale: `Policy violation: ${signals.policy_reason || "this action is blocked by policy rules"}. This cannot be overridden by user approval.`,
        follow_up_question: "",
        risk_level: "high",
        notes: [
          `Policy rule: ${signals.policy_reason || "policy_blocked = true"}`,
          "Code enforced: policy rules are deterministic and never delegated to LLM",
        ],
      },
      source: "deterministic",
      shouldCallLLM: false,
    };
  }

  // Rule 2: Missing info → clarify
  const clarifyReasons: string[] = [];
  if (!signals.intent_resolved) clarifyReasons.push("intent is unclear");
  if (!signals.entity_resolved) clarifyReasons.push("referenced entity is ambiguous");
  if (signals.missing_required_params.length > 0) {
    clarifyReasons.push(`missing: ${signals.missing_required_params.join(", ")}`);
  }

  if (clarifyReasons.length > 0) {
    return {
      decision: {
        decision: "ask_clarifying_question",
        rationale: `Cannot proceed — ${clarifyReasons.join("; ")}. Must resolve before evaluating risk.`,
        follow_up_question: generateClarifyingQuestion(signals),
        risk_level: "medium",
        notes: [
          "Deterministic: missing information is objectively detectable",
          "Clarification comes before risk assessment (rule 2 > rule 3)",
        ],
      },
      source: "deterministic",
      shouldCallLLM: false,
    };
  }

  // Rules 3-5: Risk-based decisions
  if (signals.confidence >= CONFIDENCE_THRESHOLD) {
    return {
      decision: makeRiskDecision(signals),
      source: "deterministic",
      shouldCallLLM: false,
    };
  }

  // Low confidence → LLM should weigh in, deterministic result is fallback
  return {
    decision: makeRiskDecision(signals),
    source: "deterministic",
    shouldCallLLM: true,
  };
}

function makeRiskDecision(signals: ComputedSignals): DecisionOutput {
  const hasUnresolved = signals.unresolved_preconditions.some((p) => !p.resolved);

  // Unresolved preconditions + conflicting instructions → always confirm
  if (hasUnresolved && signals.has_conflicting_prior_instruction) {
    const preconditions = signals.unresolved_preconditions
      .filter((p) => !p.resolved)
      .map((p) => p.condition);
    return {
      decision: "confirm_before_execute",
      rationale: `User said "go ahead" but a prior condition has not been confirmed as resolved: ${preconditions.join("; ")}. Confirming to ensure the precondition was actually met.`,
      follow_up_question: "",
      risk_level: "high",
      notes: [
        `Unresolved precondition(s): ${preconditions.join(", ")}`,
        temporalNote(signals),
        "Conflicting instructions + unresolved precondition = must confirm",
      ].filter(Boolean) as string[],
    };
  }

  // Conflicting instructions without preconditions
  if (signals.has_conflicting_prior_instruction) {
    return {
      decision: "confirm_before_execute",
      rationale: `Detected conflicting instructions in conversation. ${temporalNote(signals) || "Confirming to ensure the latest intent is correct."}`,
      follow_up_question: "",
      risk_level: "high",
      notes: [
        "Conflicting hold/approval detected in conversation history",
        temporalNote(signals) || "",
      ].filter(Boolean) as string[],
    };
  }

  // High risk → confirm
  if (signals.risk_score >= 0.4) {
    return {
      decision: "confirm_before_execute",
      rationale: `Risk score ${signals.risk_score} exceeds threshold. ${describeRiskFactors(signals)}`,
      follow_up_question: "",
      risk_level: signals.risk_score >= 0.6 ? "high" : "medium",
      notes: [
        `Risk factors: ${describeRiskFactors(signals)}`,
        `Confidence: ${signals.confidence}`,
      ],
    };
  }

  // Low risk, affects only user → execute silently
  if (!signals.affects_others && !signals.is_irreversible && !signals.is_external_facing && signals.risk_score < 0.15) {
    return {
      decision: "execute_silently",
      rationale: "Low-risk, internal, reversible action that affects only the user.",
      follow_up_question: "",
      risk_level: "low",
      notes: ["All signals green: low risk, internal, reversible, user-only"],
    };
  }

  // Low risk, affects others → execute and notify
  return {
    decision: "execute_and_notify",
    rationale: `Clear, low-risk action but affects other people — notifying. ${describeRiskFactors(signals)}`,
    follow_up_question: "",
    risk_level: "low",
    notes: ["Safe to execute, notification warranted because action impacts others"],
  };
}

// Check if code should override the LLM's decision based on definitive signals.
export function maybeOverrideLLM(
  llmDecision: DecisionOutput,
  signals: ComputedSignals,
  conversationState?: ConversationState
): { decision: DecisionOutput; overridden: boolean; reason: string | null } {
  // Policy blocked but LLM says execute
  if (signals.policy_blocked && llmDecision.decision !== "refuse_or_escalate") {
    return {
      decision: {
        ...llmDecision,
        decision: "refuse_or_escalate",
        rationale: `[Code override] Policy violation detected. LLM suggested "${llmDecision.decision}" but policy rules are absolute. Original rationale: ${llmDecision.rationale}`,
        risk_level: "high",
      },
      overridden: true,
      reason: "LLM ignored policy_blocked signal — code enforced refusal",
    };
  }

  // LLM says execute silently but action affects others
  if (signals.affects_others && llmDecision.decision === "execute_silently") {
    return {
      decision: {
        ...llmDecision,
        decision: "execute_and_notify",
        rationale: `[Code override] Action affects other people — cannot execute silently. ${llmDecision.rationale}`,
      },
      overridden: true,
      reason: "LLM chose silent execution for action that affects others — upgraded to notify",
    };
  }

  // LLM says execute but there are unresolved preconditions
  const hasUnresolved = signals.unresolved_preconditions.some((p) => !p.resolved);
  if (hasUnresolved && (llmDecision.decision === "execute_silently" || llmDecision.decision === "execute_and_notify")) {
    const preconditions = signals.unresolved_preconditions.filter((p) => !p.resolved).map((p) => p.condition);
    return {
      decision: {
        ...llmDecision,
        decision: "confirm_before_execute",
        rationale: `[Code override] Unresolved precondition(s): ${preconditions.join(", ")}. Must confirm before executing. ${llmDecision.rationale}`,
        risk_level: "high",
      },
      overridden: true,
      reason: `LLM ignored unresolved preconditions: ${preconditions.join(", ")}`,
    };
  }

  // LLM tries to act on incomplete information
  if (!signals.entity_resolved || !signals.intent_resolved || signals.missing_required_params.length > 0) {
    if (llmDecision.decision !== "ask_clarifying_question" && llmDecision.decision !== "refuse_or_escalate") {
      return {
        decision: {
          ...llmDecision,
          decision: "ask_clarifying_question",
          rationale: `[Code override] Cannot proceed with unresolved information. ${llmDecision.rationale}`,
          follow_up_question: generateClarifyingQuestion(signals),
        },
        overridden: true,
        reason: "LLM tried to act on incomplete information — forced clarification",
      };
    }
  }

  // State machine says HELD — cannot execute
  if (conversationState?.currentState === "HELD" &&
    (llmDecision.decision === "execute_silently" || llmDecision.decision === "execute_and_notify")) {
    return {
      decision: {
        ...llmDecision,
        decision: "confirm_before_execute",
        rationale: `[State override] Conversation is in HELD state — user explicitly asked to hold. ${llmDecision.rationale}`,
        risk_level: "high",
      },
      overridden: true,
      reason: "LLM tried to execute while conversation state is HELD",
    };
  }

  // State machine says PENDING_RELEASE — condition unresolved
  if (conversationState?.currentState === "PENDING_RELEASE" &&
    (llmDecision.decision === "execute_silently" || llmDecision.decision === "execute_and_notify")) {
    return {
      decision: {
        ...llmDecision,
        decision: "confirm_before_execute",
        rationale: `[State override] User wants to proceed but a prior condition may not be resolved. ${llmDecision.rationale}`,
        risk_level: "high",
      },
      overridden: true,
      reason: "LLM tried to execute in PENDING_RELEASE state — unresolved condition",
    };
  }

  // State machine says CONDITION_SET — action blocked by condition
  if (conversationState?.currentState === "CONDITION_SET" &&
    (llmDecision.decision === "execute_silently" || llmDecision.decision === "execute_and_notify")) {
    return {
      decision: {
        ...llmDecision,
        decision: "confirm_before_execute",
        rationale: `[State override] A precondition was set and has not been resolved. Cannot execute. ${llmDecision.rationale}`,
        risk_level: "high",
      },
      overridden: true,
      reason: "LLM tried to execute while a precondition is still active",
    };
  }

  // Safety bias — non-trivial risk should notify, not execute silently
  if (llmDecision.decision === "execute_silently" && signals.risk_score > 0) {
    return {
      decision: {
        ...llmDecision,
        decision: "execute_and_notify",
        rationale: `[Safety bias] Risk score is ${signals.risk_score} — notifying user even though risk is low. ${llmDecision.rationale}`,
      },
      overridden: true,
      reason: `Safety bias: risk_score ${signals.risk_score} > 0, upgraded from silent to notify`,
    };
  }

  return { decision: llmDecision, overridden: false, reason: null };
}

function generateClarifyingQuestion(signals: ComputedSignals): string {
  if (!signals.intent_resolved) {
    return "I'm not sure what action you'd like me to take. Could you be more specific?";
  }
  if (!signals.entity_resolved) {
    return "It looks like there are multiple possible matches. Which one did you mean?";
  }
  if (signals.missing_required_params.length > 0) {
    return `I need a bit more info: ${signals.missing_required_params.join(", ")}. Could you provide the details?`;
  }
  return "Could you provide more details about what you'd like me to do?";
}

function describeRiskFactors(signals: ComputedSignals): string {
  const factors: string[] = [];
  if (signals.is_external_facing) factors.push("external-facing");
  if (signals.is_irreversible) factors.push("irreversible");
  if (signals.contains_sensitive_domain) factors.push("sensitive content");
  if (signals.has_conflicting_prior_instruction) factors.push("conflicting instructions");
  if (signals.unresolved_preconditions.some((p) => !p.resolved)) factors.push("unresolved precondition");
  return factors.length > 0 ? factors.join(", ") : "no specific risk factors";
}

function temporalNote(signals: ComputedSignals): string {
  if (signals.hold_recency_minutes !== null && signals.approval_recency_minutes !== null) {
    if (signals.approval_recency_minutes < signals.hold_recency_minutes) {
      return `Approval is more recent (${signals.approval_recency_minutes}m ago) than hold (${signals.hold_recency_minutes}m ago), but hold may have had conditions.`;
    }
    return `Warning: hold (${signals.hold_recency_minutes}m ago) is more recent than approval (${signals.approval_recency_minutes}m ago).`;
  }
  if (signals.hold_recency_minutes !== null) {
    return `Hold was ${signals.hold_recency_minutes}m ago with no subsequent approval.`;
  }
  return "";
}
