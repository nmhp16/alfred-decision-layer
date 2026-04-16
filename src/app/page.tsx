"use client";

import { useState } from "react";
import ScenarioSelector from "@/components/ScenarioSelector";
import ActionInput from "@/components/ActionInput";
import DecisionCard from "@/components/DecisionCard";
import DebugPanel from "@/components/DebugPanel";
import { ScenarioInput, DecisionResponse } from "@/lib/schema";
import { PreloadedScenario } from "@/lib/scenarios";

const EMPTY_INPUT: ScenarioInput = {
  action: "",
  latestUserMessage: "",
  conversationHistory: [],
  simulateFailure: "none",
};

export default function Home() {
  const [input, setInput] = useState<ScenarioInput>(EMPTY_INPUT);
  const [selectedScenarioId, setSelectedScenarioId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<DecisionResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSelectScenario = (scenario: PreloadedScenario) => {
    setSelectedScenarioId(scenario.id);
    setInput(scenario.input);
    setResponse(null);
    setError(null);
  };

  const handleSubmit = async () => {
    setLoading(true);
    setError(null);
    setResponse(null);

    try {
      const res = await fetch("/api/decide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${res.status}`);
      }

      const data: DecisionResponse = await res.json();
      setResponse(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen">
      {/* Header */}
      <header className="border-b border-gray-200 bg-white">
        <div className="max-w-5xl mx-auto px-4 py-4">
          <h1 className="text-xl font-bold text-gray-900">
            alfred<span className="text-blue-600">_</span>{" "}
            <span className="font-normal text-gray-500">Execution Decision Layer</span>
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Decide when to act, confirm, clarify, or refuse — with full pipeline transparency.
          </p>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left column: Input */}
          <div className="space-y-6">
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <ScenarioSelector onSelect={handleSelectScenario} selectedId={selectedScenarioId} />
            </div>

            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h2 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-3">
                Action & Context
              </h2>
              <ActionInput
                input={input}
                onChange={setInput}
                onSubmit={handleSubmit}
                loading={loading}
              />
            </div>
          </div>

          {/* Right column: Results */}
          <div className="space-y-6">
            {error && (
              <div className="p-4 bg-red-50 border border-red-200 rounded-xl">
                <p className="text-sm font-medium text-red-800">Error</p>
                <p className="text-sm text-red-600 mt-1">{error}</p>
              </div>
            )}

            {loading && (
              <div className="flex items-center justify-center py-16">
                <div className="text-center">
                  <svg className="animate-spin h-8 w-8 text-blue-500 mx-auto mb-3" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  <p className="text-sm text-gray-500">Evaluating decision...</p>
                </div>
              </div>
            )}

            {response && !loading && (
              <>
                <DecisionCard
                  decision={response.parsedOutput}
                  fallbackApplied={response.fallbackApplied}
                  fallbackReason={response.fallbackReason}
                />
                <div className="bg-white rounded-xl border border-gray-200 p-5">
                  <DebugPanel response={response} />
                </div>
              </>
            )}

            {!response && !loading && !error && (
              <div className="flex items-center justify-center py-16">
                <div className="text-center">
                  <div className="text-4xl mb-3 text-gray-300">&#8593;</div>
                  <p className="text-sm text-gray-400">
                    Select a scenario or enter an action, then click &ldquo;Evaluate Decision&rdquo;
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
