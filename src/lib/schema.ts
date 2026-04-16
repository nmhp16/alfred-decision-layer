import { z } from "zod";

// ── Model output schema ────────────────────────────────────────────
export const DecisionEnum = z.enum([
  "execute_silently",
  "execute_and_notify",
  "confirm_before_execute",
  "ask_clarifying_question",
  "refuse_or_escalate",
]);

export const RiskLevelEnum = z.enum(["low", "medium", "high"]);

export const DecisionOutputSchema = z.object({
  decision: DecisionEnum,
  rationale: z.string(),
  follow_up_question: z.string(),
  risk_level: RiskLevelEnum,
  notes: z.array(z.string()),
});

export type DecisionOutput = z.infer<typeof DecisionOutputSchema>;

// ── Conversation message ───────────────────────────────────────────
export const MessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  timestamp: z.string().optional(),
});

export type Message = z.infer<typeof MessageSchema>;

// ── Scenario input ─────────────────────────────────────────────────
export const ScenarioInputSchema = z.object({
  action: z.string().min(1, "Action description is required"),
  latestUserMessage: z.string(),
  conversationHistory: z.array(MessageSchema),
  userState: z
    .object({
      name: z.string().optional(),
      timezone: z.string().optional(),
      preferences: z.record(z.string(), z.string()).optional(),
    })
    .optional(),
  simulateFailure: z.enum(["none", "timeout", "malformed_json"]).optional(),
});

export type ScenarioInput = z.infer<typeof ScenarioInputSchema>;

// ── Computed signals ───────────────────────────────────────────────
export interface ComputedSignals {
  intent_resolved: boolean;
  entity_resolved: boolean;
  missing_required_params: string[];
  has_prior_explicit_approval: boolean;
  has_conflicting_prior_instruction: boolean;
  is_external_facing: boolean;
  is_irreversible: boolean;
  affects_others: boolean;
  contains_sensitive_domain: boolean;
  risk_score: number;
  policy_blocked: boolean;
}

// ── Full API response ──────────────────────────────────────────────
export interface DecisionResponse {
  input: ScenarioInput;
  signals: ComputedSignals;
  prompt: string;
  rawOutput: string;
  parsedOutput: DecisionOutput;
  fallbackApplied: boolean;
  fallbackReason: string | null;
  validationStatus: "valid" | "fallback_used";
  latencyMs: number;
}
