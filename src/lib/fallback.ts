import { DecisionOutput, DecisionOutputSchema, ComputedSignals } from "./schema";

interface FallbackResult {
  output: DecisionOutput;
  fallbackApplied: boolean;
  fallbackReason: string | null;
}

/** Parse and validate LLM output, applying fallback if needed */
export function parseAndValidate(
  rawOutput: string,
  timedOut: boolean,
  llmError: string | null,
  _signals?: ComputedSignals
): FallbackResult {
  // Case 1: LLM timeout
  if (timedOut) {
    return {
      output: safeFallbackOutput("LLM request timed out after 30 seconds"),
      fallbackApplied: true,
      fallbackReason: "LLM request timed out after 30 seconds",
    };
  }

  // Case 2: LLM error
  if (llmError) {
    return {
      output: safeFallbackOutput(`LLM error: ${llmError}`),
      fallbackApplied: true,
      fallbackReason: `LLM error: ${llmError}`,
    };
  }

  // Case 3: Empty output
  if (!rawOutput.trim()) {
    return {
      output: safeFallbackOutput("LLM returned empty response"),
      fallbackApplied: true,
      fallbackReason: "LLM returned empty response",
    };
  }

  // Case 4: Try to parse JSON
  let parsed: unknown;
  try {
    let cleaned = rawOutput.trim();
    if (cleaned.startsWith("```")) {
      cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }
    parsed = JSON.parse(cleaned);
  } catch (e) {
    const reason = `Malformed JSON from LLM: ${e instanceof Error ? e.message : "parse error"}`;
    return {
      output: safeFallbackOutput(reason),
      fallbackApplied: true,
      fallbackReason: reason,
    };
  }

  // Case 5: Validate against Zod schema
  const result = DecisionOutputSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    const reason = `Schema validation failed: ${issues}`;
    return {
      output: safeFallbackOutput(reason),
      fallbackApplied: true,
      fallbackReason: reason,
    };
  }

  // Case 6: Valid output
  return {
    output: result.data,
    fallbackApplied: false,
    fallbackReason: null,
  };
}

/** Minimal fallback output — the real smart fallback lives in decision-engine.ts */
function safeFallbackOutput(reason: string): DecisionOutput {
  return {
    decision: "confirm_before_execute",
    rationale: `LLM unavailable: ${reason}. Deterministic engine will handle the decision.`,
    follow_up_question: "",
    risk_level: "high",
    notes: [reason],
  };
}
