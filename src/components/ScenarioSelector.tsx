"use client";

import { SCENARIOS, PreloadedScenario } from "@/lib/scenarios";

interface Props {
  onSelect: (scenario: PreloadedScenario) => void;
  selectedId: string | null;
}

const CATEGORY_LABELS: Record<string, { label: string; color: string }> = {
  clear: { label: "Clear", color: "bg-green-100 text-green-800" },
  ambiguous: { label: "Ambiguous", color: "bg-yellow-100 text-yellow-800" },
  risky: { label: "Risky", color: "bg-red-100 text-red-800" },
  failure: { label: "Failure", color: "bg-purple-100 text-purple-800" },
};

export default function ScenarioSelector({ onSelect, selectedId }: Props) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-2">
        Preloaded Scenarios
      </label>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {SCENARIOS.map((s) => {
          const cat = CATEGORY_LABELS[s.category];
          const isSelected = s.id === selectedId;
          return (
            <button
              key={s.id}
              onClick={() => onSelect(s)}
              className={`text-left p-3 rounded-lg border-2 transition-all ${
                isSelected
                  ? "border-blue-500 bg-blue-50"
                  : "border-gray-200 hover:border-gray-300 bg-white"
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cat.color}`}>
                  {cat.label}
                </span>
                <span className="text-sm font-medium text-gray-900 truncate">
                  {s.name}
                </span>
              </div>
              <p className="text-xs text-gray-500 line-clamp-2">{s.description}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
