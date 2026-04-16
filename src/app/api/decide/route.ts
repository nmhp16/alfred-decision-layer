import { NextRequest, NextResponse } from "next/server";
import { ScenarioInputSchema, DecisionResponse, DecisionSource } from "@/lib/schema";
import { computeSignals } from "@/lib/signals";
import { buildPrompt } from "@/lib/prompt";
import { callLLM } from "@/lib/llm";
import { parseAndValidate } from "@/lib/fallback";
import { deterministicDecision, maybeOverrideLLM } from "@/lib/decision-engine";
import { analyzeConversationState } from "@/lib/state-machine";
import { reconstructAction } from "@/lib/action-reconstruction";
import { runCounterfactuals } from "@/lib/counterfactual";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

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

    // ── Step 2: Deep analysis (all deterministic, no LLM) ──────
    const conversationState = analyzeConversationState(input, signals);
    const reconstructedAction = reconstructAction(input);
    const counterfactuals = runCounterfactuals(input, signals);

    // ── Step 3: Run deterministic decision engine ──────────────
    const detResult = deterministicDecision(signals);
    let prompt = "";
    let rawOutput = "";
    let decisionSource: DecisionSource = detResult.source;
    let output = detResult.decision;
    let fallbackApplied = false;
    let fallbackReason: string | null = null;

    // ── Step 4: Call LLM only if confidence is low ─────────────
    const needsLLM = detResult.shouldCallLLM || input.simulateFailure === "timeout" || input.simulateFailure === "malformed_json";

    if (needsLLM) {
      try {
        prompt = buildPrompt(input, signals);
      } catch (err) {
        console.error("Prompt build error:", err);
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

        const parsed = parseAndValidate(llmRaw, timedOut, llmError, signals);

        if (parsed.fallbackApplied) {
          decisionSource = "fallback";
          fallbackApplied = true;
          fallbackReason = parsed.fallbackReason;
          output = detResult.decision;
          output = {
            ...output,
            notes: [...output.notes, `LLM unavailable: ${parsed.fallbackReason}`],
          };
        } else {
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

    // ── Step 5: Build response ─────────────────────────────────
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
      conversationState,
      reconstructedAction,
      counterfactuals,
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
