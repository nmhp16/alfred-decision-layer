"use client";

import { useState } from "react";
import { DecisionResponse, ComputedSignals } from "@/lib/schema";

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

function SignalsTable({ signals }: { signals: ComputedSignals }) {
  return (
    <div>
      <SignalRow label="intent_resolved" value={String(signals.intent_resolved)} warn={!signals.intent_resolved} />
      <SignalRow label="entity_resolved" value={String(signals.entity_resolved)} warn={!signals.entity_resolved} />
      <SignalRow
        label="missing_required_params"
        value={signals.missing_required_params.length === 0 ? "[]" : JSON.stringify(signals.missing_required_params)}
        warn={signals.missing_required_params.length > 0}
      />
      <SignalRow label="has_prior_explicit_approval" value={String(signals.has_prior_explicit_approval)} />
      <SignalRow
        label="has_conflicting_prior_instruction"
        value={String(signals.has_conflicting_prior_instruction)}
        warn={signals.has_conflicting_prior_instruction}
      />
      <SignalRow label="is_external_facing" value={String(signals.is_external_facing)} warn={signals.is_external_facing} />
      <SignalRow label="is_irreversible" value={String(signals.is_irreversible)} warn={signals.is_irreversible} />
      <SignalRow label="contains_sensitive_domain" value={String(signals.contains_sensitive_domain)} warn={signals.contains_sensitive_domain} />
      <SignalRow label="risk_score" value={String(signals.risk_score)} warn={signals.risk_score > 0.4} />
      <SignalRow label="policy_blocked" value={String(signals.policy_blocked)} warn={signals.policy_blocked} />
    </div>
  );
}

export default function DebugPanel({ response }: Props) {
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

      <Section title="2. Computed Signals" defaultOpen>
        <SignalsTable signals={response.signals} />
      </Section>

      <Section title="3. Prompt Sent to Model">
        <pre className="text-xs font-mono whitespace-pre-wrap text-gray-700 bg-gray-50 p-3 rounded max-h-96 overflow-auto">
          {response.prompt}
        </pre>
      </Section>

      <Section title="4. Raw Model Output">
        <pre className="text-xs font-mono whitespace-pre-wrap text-gray-700 bg-gray-50 p-3 rounded max-h-48 overflow-auto">
          {response.rawOutput}
        </pre>
      </Section>

      <Section title="5. Parsed Decision">
        <pre className="text-xs font-mono whitespace-pre-wrap text-gray-700 bg-gray-50 p-3 rounded max-h-48 overflow-auto">
          {JSON.stringify(response.parsedOutput, null, 2)}
        </pre>
      </Section>

      <Section title="6. Fallback / Validation Status" defaultOpen={response.fallbackApplied}>
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-gray-500">Status:</span>
            <span
              className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                response.validationStatus === "valid"
                  ? "bg-green-100 text-green-700"
                  : "bg-amber-100 text-amber-700"
              }`}
            >
              {response.validationStatus === "valid" ? "Valid LLM Output" : "Fallback Used"}
            </span>
          </div>
          {response.fallbackApplied && (
            <div className="text-xs text-amber-700 bg-amber-50 p-2 rounded">
              <strong>Reason:</strong> {response.fallbackReason}
            </div>
          )}
          {!response.fallbackApplied && (
            <p className="text-xs text-gray-500">
              LLM output was valid JSON matching the expected schema. No fallback needed.
            </p>
          )}
        </div>
      </Section>
    </div>
  );
}
