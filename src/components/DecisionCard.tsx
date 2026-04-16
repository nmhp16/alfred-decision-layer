"use client";

import { DecisionOutput, DecisionSource } from "@/lib/schema";

interface Props {
  decision: DecisionOutput;
  decisionSource: DecisionSource;
  confidence: number;
  fallbackApplied: boolean;
  fallbackReason: string | null;
  expectedDecision?: string | null;
  latencyMs?: number;
}

const DECISION_STYLES: Record<string, { bg: string; border: string; text: string; label: string }> = {
  execute_silently: {
    bg: "bg-green-50",
    border: "border-green-300",
    text: "text-green-800",
    label: "Execute Silently",
  },
  execute_and_notify: {
    bg: "bg-blue-50",
    border: "border-blue-300",
    text: "text-blue-800",
    label: "Execute & Notify",
  },
  confirm_before_execute: {
    bg: "bg-amber-50",
    border: "border-amber-300",
    text: "text-amber-800",
    label: "Confirm Before Execute",
  },
  ask_clarifying_question: {
    bg: "bg-purple-50",
    border: "border-purple-300",
    text: "text-purple-800",
    label: "Ask Clarifying Question",
  },
  refuse_or_escalate: {
    bg: "bg-red-50",
    border: "border-red-300",
    text: "text-red-800",
    label: "Refuse / Escalate",
  },
};

const RISK_STYLES: Record<string, { color: string; bg: string }> = {
  low: { color: "text-green-700", bg: "bg-green-100" },
  medium: { color: "text-amber-700", bg: "bg-amber-100" },
  high: { color: "text-red-700", bg: "bg-red-100" },
};

const SOURCE_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  deterministic: { bg: "bg-cyan-100", text: "text-cyan-800", label: "Code Decided" },
  llm: { bg: "bg-violet-100", text: "text-violet-800", label: "LLM Decided" },
  llm_overridden: { bg: "bg-orange-100", text: "text-orange-800", label: "LLM Overridden by Code" },
  fallback: { bg: "bg-amber-100", text: "text-amber-800", label: "Fallback (LLM Failed)" },
};

function decisionLabel(key: string): string {
  return DECISION_STYLES[key]?.label ?? key;
}

export default function DecisionCard({
  decision,
  decisionSource,
  confidence,
  fallbackApplied,
  fallbackReason,
  expectedDecision,
  latencyMs,
}: Props) {
  const style = DECISION_STYLES[decision.decision] || DECISION_STYLES.confirm_before_execute;
  const riskStyle = RISK_STYLES[decision.risk_level] || RISK_STYLES.medium;
  const sourceStyle = SOURCE_STYLES[decisionSource] || SOURCE_STYLES.deterministic;

  const normalizedExpected = expectedDecision?.replace(/\s*\(.*\)/, "").trim();
  const matches = normalizedExpected ? decision.decision === normalizedExpected : null;

  return (
    <div className={`rounded-xl border-2 ${style.border} ${style.bg} p-5`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <span className={`text-lg font-bold ${style.text}`}>{style.label}</span>
        <div className="flex items-center gap-2">
          {latencyMs != null && (
            <span className="text-xs font-mono text-gray-400">
              {latencyMs >= 1000 ? `${(latencyMs / 1000).toFixed(1)}s` : `${latencyMs}ms`}
            </span>
          )}
          <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${riskStyle.bg} ${riskStyle.color}`}>
            Risk: {decision.risk_level}
          </span>
        </div>
      </div>

      {/* Decision source + confidence badges */}
      <div className="flex items-center gap-2 mb-3">
        <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${sourceStyle.bg} ${sourceStyle.text}`}>
          {sourceStyle.label}
        </span>
        <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${
          confidence >= 0.7 ? "bg-green-100 text-green-700" :
          confidence >= 0.4 ? "bg-amber-100 text-amber-700" :
          "bg-red-100 text-red-700"
        }`}>
          Confidence: {Math.round(confidence * 100)}%
        </span>
        {decisionSource === "deterministic" && (
          <span className="text-xs text-gray-400">LLM not called</span>
        )}
      </div>

      {/* Expected vs Actual */}
      {expectedDecision && (
        <div className={`mb-3 p-3 rounded-lg border ${
          matches ? "bg-green-50 border-green-200" : "bg-orange-50 border-orange-200"
        }`}>
          <div className="flex items-center gap-2 text-xs">
            <span className={matches ? "text-green-700" : "text-orange-700"}>
              {matches ? "MATCH" : "MISMATCH"}
            </span>
            <span className="text-gray-400">|</span>
            <span className="text-gray-600">
              Expected: <strong>{decisionLabel(normalizedExpected!)}</strong>
            </span>
            {!matches && (
              <>
                <span className="text-gray-400">vs</span>
                <span className="text-gray-600">
                  Got: <strong>{style.label}</strong>
                </span>
              </>
            )}
          </div>
        </div>
      )}

      {/* Fallback warning */}
      {fallbackApplied && (
        <div className="mb-3 p-3 bg-amber-100 border border-amber-300 rounded-lg">
          <p className="text-xs font-medium text-amber-800">Fallback Applied</p>
          <p className="text-xs text-amber-700 mt-1">{fallbackReason}</p>
        </div>
      )}

      {/* Rationale */}
      <p className="text-sm text-gray-700 mb-3">{decision.rationale}</p>

      {/* LLM Reasoning chain */}
      {decision.reasoning && decision.reasoning.length > 0 && (
        <div className="mb-3 space-y-1.5">
          <p className="text-xs font-medium text-gray-500">Reasoning</p>
          {decision.reasoning.map((r, i) => (
            <div key={i} className="flex gap-2 text-xs">
              <span className="text-gray-400 font-mono shrink-0">{i + 1}.</span>
              <div>
                <span className="font-medium text-gray-600">{r.step}</span>
                <span className="text-gray-500 ml-1">— {r.conclusion}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Follow-up question */}
      {decision.follow_up_question && (
        <div className="mb-3 p-3 bg-white/60 rounded-lg border border-gray-200">
          <p className="text-xs font-medium text-gray-500 mb-1">Follow-up Question</p>
          <p className="text-sm text-gray-800 italic">&ldquo;{decision.follow_up_question}&rdquo;</p>
        </div>
      )}

      {/* Notes */}
      {decision.notes.length > 0 && (
        <div>
          <p className="text-xs font-medium text-gray-500 mb-1">Notes</p>
          <ul className="space-y-1">
            {decision.notes.map((note, i) => (
              <li key={i} className="text-xs text-gray-600 flex items-start gap-1.5">
                <span className="text-gray-400 mt-0.5">&bull;</span>
                {note}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
