import { NextRequest, NextResponse } from "next/server";
import { ScenarioInputSchema, DecisionResponse } from "@/lib/schema";
import { computeSignals } from "@/lib/signals";
import { buildPrompt } from "@/lib/prompt";
import { callLLM } from "@/lib/llm";
import { parseAndValidate } from "@/lib/fallback";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Validate input
    const inputResult = ScenarioInputSchema.safeParse(body);
    if (!inputResult.success) {
      return NextResponse.json(
        { error: "Invalid input", details: inputResult.error.issues },
        { status: 400 }
      );
    }

    const input = inputResult.data;

    // Step 1: Compute deterministic signals
    const signals = computeSignals(input);

    // Step 2: Build prompt
    const prompt = buildPrompt(input, signals);

    // Step 3: Call LLM (or simulate failure)
    let rawOutput: string;
    let timedOut = false;
    let llmError: string | null = null;

    if (input.simulateFailure === "timeout") {
      // Simulate timeout
      rawOutput = "";
      timedOut = true;
      llmError = "Simulated LLM timeout (15s exceeded)";
    } else if (input.simulateFailure === "malformed_json") {
      // Simulate malformed output
      rawOutput = '{"decision": "execute_silently", "rationale": "test", broken json here!!!';
      timedOut = false;
      llmError = null;
    } else {
      const llmResult = await callLLM(prompt);
      rawOutput = llmResult.rawOutput;
      timedOut = llmResult.timedOut;
      llmError = llmResult.error;
    }

    // Step 4: Parse, validate, and apply fallback
    const { output, fallbackApplied, fallbackReason } = parseAndValidate(
      rawOutput,
      timedOut,
      llmError,
      signals
    );

    // Step 5: Build response with full debug info
    const response: DecisionResponse = {
      input,
      signals,
      prompt,
      rawOutput: rawOutput || (llmError ? `[Error: ${llmError}]` : "[Empty response]"),
      parsedOutput: output,
      fallbackApplied,
      fallbackReason,
      validationStatus: fallbackApplied ? "fallback_used" : "valid",
    };

    return NextResponse.json(response);
  } catch (err) {
    console.error("Decision API error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
