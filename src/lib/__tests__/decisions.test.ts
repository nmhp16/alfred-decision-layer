/**
 * Decision verification tests.
 * Run with: npx tsx src/lib/__tests__/decisions.test.ts
 *
 * Verifies that every preloaded scenario produces the expected decision
 * and that safety invariants hold across all scenarios.
 */

import { SCENARIOS } from "../scenarios";
import { computeSignals } from "../signals";
import { deterministicDecision, maybeOverrideLLM } from "../decision-engine";
import { analyzeConversationState } from "../state-machine";
import { DecisionOutput } from "../schema";

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`  FAIL: ${message}`);
  }
}

// ── Test 1: Every scenario matches expected decision ──────────────

console.log("\n=== Scenario Decision Tests ===\n");

for (const scenario of SCENARIOS) {
  const signals = computeSignals(scenario.input);
  const state = analyzeConversationState(scenario.input, signals);
  const result = deterministicDecision(signals);
  const expected = scenario.expectedDecision.replace(/\s*\(.*\)/, "").trim();

  console.log(`${scenario.name}:`);
  assert(
    result.decision.decision === expected,
    `Expected "${expected}", got "${result.decision.decision}"`
  );

  // State machine should never say READY when decision is confirm/refuse/clarify
  if (["confirm_before_execute", "refuse_or_escalate", "ask_clarifying_question"].includes(result.decision.decision)) {
    assert(
      state.currentState !== "READY",
      `State is READY but decision is ${result.decision.decision} — state machine and decision disagree`
    );
  }

  console.log(`  Decision: ${result.decision.decision} | State: ${state.currentState} | Confidence: ${signals.confidence}`);
}

// ── Test 2: Safety invariants ─────────────────────────────────────

console.log("\n=== Safety Invariant Tests ===\n");

// Policy blocked must ALWAYS refuse — even if LLM says execute
console.log("Policy override test:");
for (const scenario of SCENARIOS) {
  const signals = computeSignals(scenario.input);
  if (signals.policy_blocked) {
    const state = analyzeConversationState(scenario.input, signals);

    // Simulate LLM saying "execute_silently"
    const fakeLLM: DecisionOutput = {
      decision: "execute_silently",
      rationale: "Fake LLM says execute",
      follow_up_question: "",
      risk_level: "low",
      notes: [],
    };
    const override = maybeOverrideLLM(fakeLLM, signals, state);
    assert(override.overridden, `Policy blocked scenario "${scenario.name}" — LLM override should trigger`);
    assert(
      override.decision.decision === "refuse_or_escalate",
      `Policy blocked must refuse, got "${override.decision.decision}"`
    );

    // State should be BLOCKED
    assert(
      state.currentState === "BLOCKED",
      `Policy blocked state should be BLOCKED, got "${state.currentState}"`
    );
  }
}

// Affects others must NEVER execute silently
console.log("Affects-others override test:");
for (const scenario of SCENARIOS) {
  const signals = computeSignals(scenario.input);
  if (signals.affects_others && !signals.policy_blocked) {
    const state = analyzeConversationState(scenario.input, signals);
    const fakeLLM: DecisionOutput = {
      decision: "execute_silently",
      rationale: "Fake LLM says silent",
      follow_up_question: "",
      risk_level: "low",
      notes: [],
    };
    const override = maybeOverrideLLM(fakeLLM, signals, state);
    assert(
      override.decision.decision !== "execute_silently",
      `"${scenario.name}" affects others — must not execute silently, got "${override.decision.decision}"`
    );
  }
}

// Missing info must ALWAYS clarify
console.log("Missing info test:");
for (const scenario of SCENARIOS) {
  const signals = computeSignals(scenario.input);
  if (!signals.entity_resolved || !signals.intent_resolved || signals.missing_required_params.length > 0) {
    const result = deterministicDecision(signals);
    assert(
      result.decision.decision === "ask_clarifying_question",
      `"${scenario.name}" has missing info — must clarify, got "${result.decision.decision}"`
    );
  }
}

// HELD state must never allow execution
console.log("HELD state override test:");
{
  const signals = computeSignals(SCENARIOS[0].input); // doesn't matter, we'll fake it
  const fakeState = {
    currentState: "HELD",
    steps: [],
    stateHistory: ["IDLE", "PROPOSED", "HELD"],
    finalInsight: "test",
  };
  const fakeLLM: DecisionOutput = {
    decision: "execute_and_notify",
    rationale: "Fake",
    follow_up_question: "",
    risk_level: "low",
    notes: [],
  };
  const override = maybeOverrideLLM(fakeLLM, signals, fakeState);
  assert(
    override.decision.decision === "confirm_before_execute",
    `HELD state + execute → must force confirm, got "${override.decision.decision}"`
  );
}

// ── Summary ───────────────────────────────────────────────────────

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
