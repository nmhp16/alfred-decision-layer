"use client";

import { ScenarioInput, Message } from "@/lib/schema";

interface Props {
  input: ScenarioInput;
  onChange: (input: ScenarioInput) => void;
  onSubmit: () => void;
  loading: boolean;
}

export default function ActionInput({ input, onChange, onSubmit, loading }: Props) {
  const updateField = <K extends keyof ScenarioInput>(key: K, value: ScenarioInput[K]) => {
    onChange({ ...input, [key]: value });
  };

  const updateMessage = (index: number, field: keyof Message, value: string) => {
    const updated = [...input.conversationHistory];
    updated[index] = { ...updated[index], [field]: value };
    updateField("conversationHistory", updated);
  };

  const addMessage = () => {
    updateField("conversationHistory", [
      ...input.conversationHistory,
      { role: "user" as const, content: "", timestamp: "" },
    ]);
  };

  const removeMessage = (index: number) => {
    updateField(
      "conversationHistory",
      input.conversationHistory.filter((_, i) => i !== index)
    );
  };

  return (
    <div className="space-y-4">
      {/* Action */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Proposed Action
        </label>
        <input
          type="text"
          value={input.action}
          onChange={(e) => updateField("action", e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          placeholder="e.g., Send email reply to external partner"
        />
      </div>

      {/* Latest User Message */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Latest User Message
        </label>
        <input
          type="text"
          value={input.latestUserMessage}
          onChange={(e) => updateField("latestUserMessage", e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          placeholder='e.g., "Yep, send it"'
        />
      </div>

      {/* Conversation History */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="block text-sm font-medium text-gray-700">
            Conversation History
          </label>
          <button
            onClick={addMessage}
            className="text-xs text-blue-600 hover:text-blue-800 font-medium"
          >
            + Add message
          </button>
        </div>
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {input.conversationHistory.map((msg, i) => (
            <div key={i} className="flex gap-2 items-start">
              <select
                value={msg.role}
                onChange={(e) => updateMessage(i, "role", e.target.value)}
                className="px-2 py-1.5 border border-gray-300 rounded text-xs bg-white"
              >
                <option value="user">user</option>
                <option value="assistant">assistant</option>
              </select>
              <input
                type="text"
                value={msg.content}
                onChange={(e) => updateMessage(i, "content", e.target.value)}
                className="flex-1 px-2 py-1.5 border border-gray-300 rounded text-xs"
                placeholder="Message content..."
              />
              <input
                type="text"
                value={msg.timestamp || ""}
                onChange={(e) => updateMessage(i, "timestamp", e.target.value)}
                className="w-36 px-2 py-1.5 border border-gray-300 rounded text-xs"
                placeholder="timestamp"
              />
              <button
                onClick={() => removeMessage(i)}
                className="text-red-400 hover:text-red-600 text-xs px-1"
              >
                ×
              </button>
            </div>
          ))}
          {input.conversationHistory.length === 0 && (
            <p className="text-xs text-gray-400 italic">No conversation history</p>
          )}
        </div>
      </div>

      {/* Failure Simulation */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Failure Simulation
        </label>
        <select
          value={input.simulateFailure || "none"}
          onChange={(e) =>
            updateField(
              "simulateFailure",
              e.target.value as "none" | "timeout" | "malformed_json"
            )
          }
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
        >
          <option value="none">None (normal LLM call)</option>
          <option value="timeout">Simulate LLM timeout</option>
          <option value="malformed_json">Simulate malformed JSON response</option>
        </select>
      </div>

      {/* Submit */}
      <button
        onClick={onSubmit}
        disabled={loading || !input.action.trim()}
        className={`w-full py-2.5 px-4 rounded-lg font-medium text-sm transition-all ${
          loading || !input.action.trim()
            ? "bg-gray-300 text-gray-500 cursor-not-allowed"
            : "bg-blue-600 text-white hover:bg-blue-700 active:bg-blue-800"
        }`}
      >
        {loading ? (
          <span className="flex items-center justify-center gap-2">
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            Evaluating...
          </span>
        ) : (
          "Evaluate Decision"
        )}
      </button>
    </div>
  );
}
