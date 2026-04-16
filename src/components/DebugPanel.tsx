"use client";

import { useState } from "react";
import { DecisionResponse, ComputedSignals, CounterfactualResult, ConversationState, ReconstructedActionResult } from "@/lib/schema";

interface Props {
  response: DecisionResponse;
}

function Section({
  title,
  defaultOpen,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-gray-50 hover:bg-gray-100 transition-colors text-sm font-medium text-gray-700"
      >
        {title}
        <svg
          className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && <div className="p-4 bg-white">{children}</div>}
    </div>
  );
}

function SignalRow({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-gray-100 last:border-0">
      <span className="text-xs font-mono text-gray-600">{label}</span>
      <span className={`text-xs font-mono ${warn ? "text-amber-600 font-bold" : "text-gray-800"}`}>
        {value}
      </span>
    </div>
  );
}

// ── State Machine Visualization ───────────────────────────────────

function StateMachineView({ state }: { state: ConversationState }) {
  const STATE_COLORS: Record<string, string> = {
    IDLE: "bg-gray-200 text-gray-700",
    PROPOSED: "bg-blue-100 text-blue-700",
    DRAFTED: "bg-blue-200 text-blue-800",
    AWAITING_APPROVAL: "bg-indigo-100 text-indigo-700",
    APPROVED: "bg-green-100 text-green-700",
    HELD: "bg-red-100 text-red-700",
    CONDITION_SET: "bg-orange-100 text-orange-700",
    CONDITION_MET: "bg-emerald-100 text-emerald-700",
    PENDING_RELEASE: "bg-amber-200 text-amber-800",
    BLOCKED: "bg-red-300 text-red-900",
    READY: "bg-green-200 text-green-800",
  };

  const ROLE_STYLES: Record<string, string> = {
    user: "border-blue-300 bg-blue-50",
    assistant: "border-gray-300 bg-gray-50",
    system: "border-purple-300 bg-purple-50",
  };

  return (
    <div className="space-y-3">
      {/* State flow */}
      <div className="flex flex-wrap items-center gap-1">
        {state.stateHistory.map((s, i) => (
          <div key={i} className="flex items-center gap-1">
            <span className={`text-[10px] font-bold px-2 py-1 rounded ${STATE_COLORS[s] || "bg-gray-100 text-gray-600"}`}>
              {s}
            </span>
            {i < state.stateHistory.length - 1 && (
              <span className="text-gray-300 text-xs">→</span>
            )}
          </div>
        ))}
      </div>

      {/* Incremental steps — only show state-changing steps to reduce noise */}
      {state.steps.filter((s) => s.changed).length > 0 && (
        <div className="space-y-1.5">
          {state.steps.filter((s) => s.changed).map((step, i) => (
            <div key={i} className={`text-xs rounded-lg border-l-4 pl-3 py-2 pr-2 ${ROLE_STYLES[step.role] || "border-gray-200 bg-gray-50"}`}>
              <div className="flex items-center gap-2 mb-1">
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${STATE_COLORS[step.newState] || "bg-gray-100"}`}>
                  {step.previousState} → {step.newState}
                </span>
                <span className="text-gray-400">{step.role}{step.timestamp ? ` @ ${step.timestamp}` : ""}</span>
              </div>
              {step.role !== "system" && (
                <div className="text-gray-400 truncate mb-1">&ldquo;{step.message}&rdquo;</div>
              )}
              <div className="text-gray-700">{step.understanding}</div>
            </div>
          ))}
        </div>
      )}

      {/* Final insight */}
      <div className={`p-2 rounded text-xs ${STATE_COLORS[state.currentState] || "bg-gray-100"}`}>
        <strong>Final state: {state.currentState}</strong> — {state.finalInsight}
      </div>
    </div>
  );
}

// ── Action Reconstruction View ────────────────────────────────────

function ReconstructedActionView({ action }: { action: ReconstructedActionResult }) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <div className="p-2 bg-gray-50 rounded">
          <p className="text-[10px] font-semibold text-gray-400 uppercase">Action Type</p>
          <p className="text-xs font-mono text-gray-800">{action.actionType}</p>
        </div>
        <div className="p-2 bg-gray-50 rounded">
          <p className="text-[10px] font-semibold text-gray-400 uppercase">What</p>
          <p className="text-xs text-gray-800">{action.what}</p>
        </div>
      </div>

      {action.who.length > 0 && (
        <div className="p-2 bg-gray-50 rounded">
          <p className="text-[10px] font-semibold text-gray-400 uppercase">Who (Recipients/Affected)</p>
          <div className="flex flex-wrap gap-1 mt-1">
            {action.who.map((w, i) => (
              <span key={i} className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded font-mono">{w}</span>
            ))}
          </div>
        </div>
      )}

      {action.content && (
        <div className="p-2 bg-gray-50 rounded">
          <p className="text-[10px] font-semibold text-gray-400 uppercase">Content</p>
          <p className="text-xs text-gray-700 italic mt-1">&ldquo;{action.content.slice(0, 150)}{action.content.length > 150 ? "..." : ""}&rdquo;</p>
        </div>
      )}

      {action.conditions.length > 0 && (
        <div className="p-2 bg-orange-50 rounded border border-orange-200">
          <p className="text-[10px] font-semibold text-orange-500 uppercase">Conditions Set</p>
          {action.conditions.map((c, i) => (
            <p key={i} className="text-xs text-orange-700 mt-1">&bull; {c}</p>
          ))}
        </div>
      )}

      {action.reconstructedFrom.length > 0 && (
        <details className="text-xs text-gray-500">
          <summary className="cursor-pointer hover:text-gray-700">Evidence ({action.reconstructedFrom.length} sources)</summary>
          <ul className="mt-1 space-y-0.5 pl-2">
            {action.reconstructedFrom.map((s, i) => (
              <li key={i} className="text-gray-400">{s}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

// ── Counterfactual View ───────────────────────────────────────────

function CounterfactualView({ counterfactuals }: { counterfactuals: CounterfactualResult[] }) {
  if (counterfactuals.length === 0) {
    return <p className="text-xs text-gray-400">No counterfactuals applicable for this scenario.</p>;
  }

  return (
    <div className="space-y-2">
      {counterfactuals.map((cf) => (
        <div
          key={cf.id}
          className={`p-3 rounded-lg border ${cf.changed ? "bg-purple-50 border-purple-200" : "bg-gray-50 border-gray-200"}`}
        >
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-medium text-gray-700">{cf.label}</span>
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
              cf.changed ? "bg-purple-200 text-purple-800" : "bg-gray-200 text-gray-600"
            }`}>
              {cf.changed ? "DECISION CHANGES" : "NO CHANGE"}
            </span>
          </div>

          {cf.changed && (
            <div className="flex items-center gap-2 my-1.5">
              <span className="text-xs font-mono bg-white px-2 py-0.5 rounded border">{cf.originalDecision.replace(/_/g, " ")}</span>
              <span className="text-purple-400">→</span>
              <span className="text-xs font-mono bg-purple-100 px-2 py-0.5 rounded border border-purple-200 text-purple-700">
                {cf.newDecision.replace(/_/g, " ")}
              </span>
            </div>
          )}

          <p className="text-xs text-gray-600 mt-1">{cf.insight}</p>

          <div className="flex gap-3 mt-1.5 text-[10px] text-gray-400">
            <span>Confidence: {Math.round(cf.originalConfidence * 100)}% → {Math.round(cf.newConfidence * 100)}%</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Signals Table ─────────────────────────────────────────────────

function SignalsTable({ signals }: { signals: ComputedSignals }) {
  return (
    <div>
      <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Core Signals</p>
      <SignalRow label="intent_resolved" value={String(signals.intent_resolved)} warn={!signals.intent_resolved} />
      <SignalRow label="entity_resolved" value={String(signals.entity_resolved)} warn={!signals.entity_resolved} />
      <SignalRow
        label="missing_required_params"
        value={signals.missing_required_params.length === 0 ? "[]" : JSON.stringify(signals.missing_required_params)}
        warn={signals.missing_required_params.length > 0}
      />
      <SignalRow label="has_prior_explicit_approval" value={String(signals.has_prior_explicit_approval)} />
      <SignalRow label="has_conflicting_prior_instruction" value={String(signals.has_conflicting_prior_instruction)} warn={signals.has_conflicting_prior_instruction} />
      <SignalRow label="is_external_facing" value={String(signals.is_external_facing)} warn={signals.is_external_facing} />
      <SignalRow label="is_irreversible" value={String(signals.is_irreversible)} warn={signals.is_irreversible} />
      <SignalRow label="affects_others" value={String(signals.affects_others)} warn={signals.affects_others} />
      <SignalRow label="contains_sensitive_domain" value={String(signals.contains_sensitive_domain)} warn={signals.contains_sensitive_domain} />
      <SignalRow label="risk_score" value={String(signals.risk_score)} warn={signals.risk_score > 0.4} />
      <SignalRow label="policy_blocked" value={String(signals.policy_blocked)} warn={signals.policy_blocked} />
      {signals.policy_reason && (
        <div className="text-xs text-red-600 pl-2 py-0.5 font-medium">{signals.policy_reason}</div>
      )}

      <p className="text-xs font-semibold text-gray-500 uppercase mt-4 mb-2">Temporal</p>
      <SignalRow label="hold_recency_minutes" value={signals.hold_recency_minutes !== null ? `${signals.hold_recency_minutes}m ago` : "n/a"} warn={signals.hold_recency_minutes !== null && signals.hold_recency_minutes < 30} />
      <SignalRow label="approval_recency_minutes" value={signals.approval_recency_minutes !== null ? `${signals.approval_recency_minutes}m ago` : "n/a"} />

      {signals.unresolved_preconditions.length > 0 && (
        <>
          <p className="text-xs font-semibold text-gray-500 uppercase mt-4 mb-2">Preconditions</p>
          {signals.unresolved_preconditions.map((p, i) => (
            <div key={i} className={`text-xs p-2 rounded mb-1 ${p.resolved ? "bg-green-50" : "bg-red-50"}`}>
              <span className={`font-mono ${p.resolved ? "text-green-700" : "text-red-700"}`}>
                {p.resolved ? "RESOLVED" : "UNRESOLVED"}
              </span>
              <span className="text-gray-600 ml-2">{p.condition}</span>
              {p.ageMinutes !== null && <span className="text-gray-400 ml-2">({p.ageMinutes}m ago)</span>}
            </div>
          ))}
        </>
      )}

      <p className="text-xs font-semibold text-gray-500 uppercase mt-4 mb-2">Engine Confidence</p>
      <SignalRow label="confidence" value={`${Math.round(signals.confidence * 100)}%`} warn={signals.confidence < 0.7} />
      {signals.confidence_factors.map((f, i) => (
        <div key={i} className="text-xs text-gray-500 pl-2 py-0.5">
          {signals.confidence < 0.7 ? "~" : "+"} {f}
        </div>
      ))}
    </div>
  );
}

// ── Main DebugPanel ───────────────────────────────────────────────

export default function DebugPanel({ response }: Props) {
  const changedCount = response.counterfactuals.filter((c) => c.changed).length;

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-gray-600 uppercase tracking-wide">
        Debug Pipeline
      </h3>

      <Section title="1. Inputs" defaultOpen>
        <pre className="text-xs font-mono whitespace-pre-wrap text-gray-700 bg-gray-50 p-3 rounded max-h-48 overflow-auto">
          {JSON.stringify(response.input, null, 2)}
        </pre>
      </Section>

      <Section title="2. Conversation State Machine" defaultOpen>
        <StateMachineView state={response.conversationState} />
      </Section>

      <Section title="3. Reconstructed Action" defaultOpen>
        <ReconstructedActionView action={response.reconstructedAction} />
      </Section>

      <Section title="4. Computed Signals">
        <SignalsTable signals={response.signals} />
      </Section>

      <Section
        title={`5. Counterfactual Analysis${changedCount > 0 ? ` (${changedCount} decision-changing)` : ""}`}
        defaultOpen={changedCount > 0}
      >
        <CounterfactualView counterfactuals={response.counterfactuals} />
      </Section>

      <Section title={`6. Prompt${response.decisionSource === "deterministic" ? " (skipped)" : ""}`}>
        <pre className="text-xs font-mono whitespace-pre-wrap text-gray-700 bg-gray-50 p-3 rounded max-h-96 overflow-auto">
          {response.prompt}
        </pre>
      </Section>

      <Section title={`7. Raw Model Output${response.decisionSource === "deterministic" ? " (skipped)" : ""}`}>
        <pre className="text-xs font-mono whitespace-pre-wrap text-gray-700 bg-gray-50 p-3 rounded max-h-48 overflow-auto">
          {response.rawOutput}
        </pre>
      </Section>

      <Section title="8. Parsed Decision">
        <pre className="text-xs font-mono whitespace-pre-wrap text-gray-700 bg-gray-50 p-3 rounded max-h-48 overflow-auto">
          {JSON.stringify(response.parsedOutput, null, 2)}
        </pre>
      </Section>

      <Section title="9. Decision Source & Validation" defaultOpen={response.fallbackApplied || response.decisionSource === "llm_overridden"}>
        <div className="space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-medium text-gray-500">Source:</span>
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
              response.decisionSource === "deterministic" ? "bg-cyan-100 text-cyan-700" :
              response.decisionSource === "llm" ? "bg-violet-100 text-violet-700" :
              response.decisionSource === "llm_overridden" ? "bg-orange-100 text-orange-700" :
              "bg-amber-100 text-amber-700"
            }`}>
              {response.decisionSource === "deterministic" ? "Deterministic (LLM not called)" :
               response.decisionSource === "llm" ? "LLM (low confidence case)" :
               response.decisionSource === "llm_overridden" ? "LLM called but code overrode" :
               "Fallback (LLM failed)"}
            </span>
            <span className="text-xs font-mono text-gray-400">
              {response.latencyMs >= 1000 ? `${(response.latencyMs / 1000).toFixed(1)}s` : `${response.latencyMs}ms`}
            </span>
          </div>
          {response.decisionSource === "llm_overridden" && (
            <div className="text-xs text-orange-700 bg-orange-50 p-2 rounded">
              <strong>Override reason:</strong> Code enforced safety constraint that LLM missed.
            </div>
          )}
          {response.fallbackApplied && (
            <div className="text-xs text-amber-700 bg-amber-50 p-2 rounded">
              <strong>Fallback reason:</strong> {response.fallbackReason}
            </div>
          )}
        </div>
      </Section>
    </div>
  );
}
