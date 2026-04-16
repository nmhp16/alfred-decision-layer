import { DecisionOutput, DecisionOutputSchema, ComputedSignals } from "./schema";

interface FallbackResult {
  output: DecisionOutput;
  fallbackApplied: boolean;
  fallbackReason: string | null;
}

/** Safe default — never execute silently on fallback */
function safeFallback(reason: string, signals?: ComputedSignals): FallbackResult {
  // If we know context is missing, ask a clarifying question
  if (signals && (!signals.intent_resolved || !signals.entity_resolved || signals.missing_required_params.length > 0)) {
    return {
      output: {
        decision: "ask_clarifying_question",
        rationale: `Fallback triggered: ${reason}. Insufficient context to proceed safely.`,
        follow_up_question: "Could you provide more details about what you'd like me to do?",
        risk_level: "medium",
        notes: [`Fallback reason: ${reason}`, "System defaulted to asking for clarification"],
      },
      fallbackApplied: true,
      fallbackReason: reason,
    };
  }

  // Default: confirm before executing
  return {
    output: {
      decision: "confirm_before_execute",
      rationale: `Fallback triggered: ${reason}. Defaulting to safe confirmation to avoid unintended actions.`,
      follow_up_question: "",
      risk_level: "high",
      notes: [`Fallback reason: ${reason}`, "System defaulted to confirmation for safety"],
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
    return safeFallback("LLM request timed out after 15 seconds", signals);
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
