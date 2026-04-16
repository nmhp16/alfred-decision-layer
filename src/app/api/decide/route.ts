import { NextRequest, NextResponse } from "next/server";
import { ScenarioInputSchema, DecisionResponse, DecisionSource } from "@/lib/schema";
import { computeSignals } from "@/lib/signals";
import { buildPrompt } from "@/lib/prompt";
import { callLLM } from "@/lib/llm";
import { parseAndValidate } from "@/lib/fallback";
import { deterministicDecision, maybeOverrideLLM } from "@/lib/decision-engine";

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
    const startTime = Date.now();

    // ── Step 1: Compute deterministic signals ──────────────────
    let signals;
    try {
      signals = computeSignals(input);
    } catch (err) {
      console.error("Signal computation error:", err);
      return NextResponse.json(
        { error: "Failed to compute signals", details: String(err) },
        { status: 500 }
      );
    }

    // ── Step 2: Run deterministic decision engine ──────────────
    const detResult = deterministicDecision(signals);
    let prompt = "";
    let rawOutput = "";
    let decisionSource: DecisionSource = detResult.source;
    let output = detResult.decision;
    let fallbackApplied = false;
    let fallbackReason: string | null = null;

    // ── Step 3: Call LLM only if confidence is low ─────────────
    // Or if a failure simulation is requested
    const needsLLM = detResult.shouldCallLLM || input.simulateFailure === "timeout" || input.simulateFailure === "malformed_json";

    if (needsLLM) {
      try {
        prompt = buildPrompt(input, signals);
      } catch (err) {
        console.error("Prompt build error:", err);
        // Fall back to deterministic decision
        decisionSource = "fallback";
        fallbackApplied = true;
        fallbackReason = `Prompt build failed: ${err}`;
      }

      if (prompt) {
        let llmRaw: string;
        let timedOut = false;
        let llmError: string | null = null;

        if (input.simulateFailure === "timeout") {
          llmRaw = "";
          timedOut = true;
          llmError = "Simulated LLM timeout (30s exceeded)";
        } else if (input.simulateFailure === "malformed_json") {
          llmRaw = '{"decision": "execute_silently", "rationale": "test", broken json here!!!';
          timedOut = false;
          llmError = null;
        } else {
          const llmResult = await callLLM(prompt);
          llmRaw = llmResult.rawOutput;
          timedOut = llmResult.timedOut;
          llmError = llmResult.error;
        }

        rawOutput = llmRaw || (llmError ? `[Error: ${llmError}]` : "[Empty response]");

        // Parse LLM output
        const parsed = parseAndValidate(llmRaw, timedOut, llmError, signals);

        if (parsed.fallbackApplied) {
          // LLM failed — use deterministic decision as fallback
          decisionSource = "fallback";
          fallbackApplied = true;
          fallbackReason = parsed.fallbackReason;
          // Keep the deterministic decision (detResult.decision)
          output = detResult.decision;
          output = {
            ...output,
            notes: [...output.notes, `LLM unavailable: ${parsed.fallbackReason}`],
          };
        } else {
          // LLM succeeded — check if code needs to override
          const override = maybeOverrideLLM(parsed.output, signals);
          output = override.decision;
          if (override.overridden) {
            decisionSource = "llm_overridden";
            output = {
              ...output,
              notes: [...output.notes, `Code override: ${override.reason}`],
            };
          } else {
            decisionSource = "llm";
          }
        }
      }
    }

    // ── Step 4: Build response with full debug info ────────────
    const latencyMs = Date.now() - startTime;
    const response: DecisionResponse = {
      input,
      signals,
      prompt: prompt || "[LLM not called — deterministic engine was confident]",
      rawOutput: rawOutput || "[LLM not called — deterministic engine was confident]",
      parsedOutput: output,
      decisionSource,
      fallbackApplied,
      fallbackReason,
      validationStatus: fallbackApplied ? "fallback_used" : "valid",
      latencyMs,
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
