import { DecisionOutput, DecisionOutputSchema, ComputedSignals } from "./schema";

interface FallbackResult {
  output: DecisionOutput;
  fallbackApplied: boolean;
  fallbackReason: string | null;
}

// ── Rule-based decision engine (used when LLM is unavailable) ─────

function ruleBasedDecision(signals: ComputedSignals): DecisionOutput {
  const reasons: string[] = [];

  // Hard policy block — always refuse
  if (signals.policy_blocked) {
    return {
      decision: "refuse_or_escalate",
      rationale: "Policy violation detected. This action is blocked regardless of user intent.",
      follow_up_question: "",
      risk_level: "high",
      notes: ["Rule-based: policy_blocked signal triggered refusal"],
    };
  }

  // Missing intent or entity — ask for clarification
  if (!signals.intent_resolved) {
    reasons.push("intent is unclear");
  }
  if (!signals.entity_resolved) {
    reasons.push("referenced entity is ambiguous");
  }
  if (signals.missing_required_params.length > 0) {
    reasons.push(`missing required info: ${signals.missing_required_params.join(", ")}`);
  }
  if (reasons.length > 0) {
    return {
      decision: "ask_clarifying_question",
      rationale: `Cannot proceed: ${reasons.join("; ")}.`,
      follow_up_question: generateClarifyingQuestion(signals),
      risk_level: "medium",
      notes: ["Rule-based: insufficient context to act safely"],
    };
  }

  // Conflicting instructions — always confirm
  if (signals.has_conflicting_prior_instruction) {
    return {
      decision: "confirm_before_execute",
      rationale: "Detected conflicting instructions in conversation history. Confirming to ensure the latest intent is correct.",
      follow_up_question: "",
      risk_level: "high",
      notes: ["Rule-based: conflicting prior instructions detected"],
    };
  }

  // High risk (external + sensitive/irreversible) — confirm
  if (signals.risk_score >= 0.4) {
    return {
      decision: "confirm_before_execute",
      rationale: `Risk score ${signals.risk_score} exceeds silent execution threshold. ${describeRiskFactors(signals)}`,
      follow_up_question: "",
      risk_level: signals.risk_score >= 0.6 ? "high" : "medium",
      notes: ["Rule-based: risk score above confirmation threshold (0.4)"],
    };
  }

  // Low risk, internal, reversible, affects only user — execute silently
  if (!signals.is_external_facing && !signals.is_irreversible && !signals.affects_others && signals.risk_score < 0.15) {
    return {
      decision: "execute_silently",
      rationale: "Low-risk, internal, reversible action that affects only the user.",
      follow_up_question: "",
      risk_level: "low",
      notes: ["Rule-based: all signals indicate safe silent execution"],
    };
  }

  // Low risk but affects others — execute and notify
  return {
    decision: "execute_and_notify",
    rationale: `Action is clear and low-risk but affects other people — notifying user. ${describeRiskFactors(signals)}`,
    follow_up_question: "",
    risk_level: "low",
    notes: ["Rule-based: safe to execute with notification (affects others)"],
  };
}

function generateClarifyingQuestion(signals: ComputedSignals): string {
  if (!signals.intent_resolved) {
    return "I'm not sure what action you'd like me to take. Could you be more specific?";
  }
  if (!signals.entity_resolved) {
    return "It looks like there are multiple possible matches. Which one did you mean?";
  }
  if (signals.missing_required_params.length > 0) {
    return `I need a bit more info before proceeding: ${signals.missing_required_params.join(", ")}. Could you fill in the details?`;
  }
  return "Could you provide more details about what you'd like me to do?";
}

function describeRiskFactors(signals: ComputedSignals): string {
  const factors: string[] = [];
  if (signals.is_external_facing) factors.push("external-facing");
  if (signals.is_irreversible) factors.push("irreversible");
  if (signals.contains_sensitive_domain) factors.push("sensitive content");
  if (signals.has_conflicting_prior_instruction) factors.push("conflicting instructions");
  return factors.length > 0 ? `Risk factors: ${factors.join(", ")}.` : "";
}

/** Safe fallback — uses rule-based engine when signals are available */
function safeFallback(reason: string, signals?: ComputedSignals): FallbackResult {
  // If we have signals, use the rule-based engine for a real decision
  if (signals) {
    const output = ruleBasedDecision(signals);
    return {
      output: {
        ...output,
        rationale: `[Rule-based fallback] ${output.rationale}`,
        notes: [...output.notes, `LLM unavailable: ${reason}`],
      },
      fallbackApplied: true,
      fallbackReason: reason,
    };
  }

  // No signals at all — truly blind, default to confirmation
  return {
    output: {
      decision: "confirm_before_execute",
      rationale: `Fallback triggered: ${reason}. No signals available — defaulting to safe confirmation.`,
      follow_up_question: "",
      risk_level: "high",
      notes: [`Fallback reason: ${reason}`, "No computed signals — cannot make informed decision"],
    },
    fallbackApplied: true,
    fallbackReason: reason,
  };
}

/** Parse and validate LLM output, applying fallback if needed */
export function parseAndValidate(
  rawOutput: string,
  timedOut: boolean,
  llmError: string | null,
  signals?: ComputedSignals
): FallbackResult {
  // Case 1: LLM timeout
  if (timedOut) {
    return safeFallback("LLM request timed out after 30 seconds", signals);
  }

  // Case 2: LLM error
  if (llmError) {
    return safeFallback(`LLM error: ${llmError}`, signals);
  }

  // Case 3: Empty output
  if (!rawOutput.trim()) {
    return safeFallback("LLM returned empty response", signals);
  }

  // Case 4: Try to parse JSON
  let parsed: unknown;
  try {
    // Strip markdown code fences if present
    let cleaned = rawOutput.trim();
    if (cleaned.startsWith("```")) {
      cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }
    parsed = JSON.parse(cleaned);
  } catch (e) {
    return safeFallback(
      `Malformed JSON from LLM: ${e instanceof Error ? e.message : "parse error"}`,
      signals
    );
  }

  // Case 5: Validate against Zod schema
  const result = DecisionOutputSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    return safeFallback(`Schema validation failed: ${issues}`, signals);
  }

  // Case 6: Valid output
  return {
    output: result.data,
    fallbackApplied: false,
    fallbackReason: null,
  };
}
