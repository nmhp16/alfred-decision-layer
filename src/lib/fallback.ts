import { DecisionOutput, DecisionOutputSchema, ComputedSignals } from "./schema";

interface FallbackResult {
  output: DecisionOutput;
  fallbackApplied: boolean;
  fallbackReason: string | null;
}

export function parseAndValidate(
  rawOutput: string,
  timedOut: boolean,
  llmError: string | null,
  _signals?: ComputedSignals
): FallbackResult {
  if (timedOut) {
    return {
      output: safeFallbackOutput("LLM request timed out after 30 seconds"),
      fallbackApplied: true,
      fallbackReason: "LLM request timed out after 30 seconds",
    };
  }

  if (llmError) {
    return {
      output: safeFallbackOutput(`LLM error: ${llmError}`),
      fallbackApplied: true,
      fallbackReason: `LLM error: ${llmError}`,
    };
  }

  if (!rawOutput.trim()) {
    return {
      output: safeFallbackOutput("LLM returned empty response"),
      fallbackApplied: true,
      fallbackReason: "LLM returned empty response",
    };
  }

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

  return {
    output: result.data,
    fallbackApplied: false,
    fallbackReason: null,
  };
}

function safeFallbackOutput(reason: string): DecisionOutput {
  return {
    decision: "confirm_before_execute",
    rationale: `LLM unavailable: ${reason}. Deterministic engine will handle the decision.`,
    follow_up_question: "",
    risk_level: "high",
    notes: [reason],
  };
}
