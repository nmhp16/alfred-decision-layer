"use client";

import { DecisionOutput } from "@/lib/schema";

interface Props {
  decision: DecisionOutput;
  fallbackApplied: boolean;
  fallbackReason: string | null;
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

export default function DecisionCard({ decision, fallbackApplied, fallbackReason }: Props) {
  const style = DECISION_STYLES[decision.decision] || DECISION_STYLES.confirm_before_execute;
  const riskStyle = RISK_STYLES[decision.risk_level] || RISK_STYLES.medium;

  return (
    <div className={`rounded-xl border-2 ${style.border} ${style.bg} p-5`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <span className={`text-lg font-bold ${style.text}`}>{style.label}</span>
        <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${riskStyle.bg} ${riskStyle.color}`}>
          Risk: {decision.risk_level}
        </span>
      </div>

      {/* Fallback warning */}
      {fallbackApplied && (
        <div className="mb-3 p-3 bg-amber-100 border border-amber-300 rounded-lg">
          <p className="text-xs font-medium text-amber-800">
            ⚠ Fallback Applied
          </p>
          <p className="text-xs text-amber-700 mt-1">{fallbackReason}</p>
        </div>
      )}

      {/* Rationale */}
      <p className="text-sm text-gray-700 mb-3">{decision.rationale}</p>

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
                <span className="text-gray-400 mt-0.5">•</span>
                {note}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
