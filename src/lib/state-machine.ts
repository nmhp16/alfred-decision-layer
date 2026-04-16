import { ScenarioInput, ComputedSignals } from "./schema";

// ── Action lifecycle states ────────────────────────────────────────

export type ActionState =
  | "IDLE"
  | "PROPOSED"
  | "DRAFTED"
  | "AWAITING_APPROVAL"
  | "APPROVED"
  | "HELD"
  | "CONDITION_SET"
  | "CONDITION_MET"
  | "PENDING_RELEASE"
  | "BLOCKED"
  | "READY";

// ── Each step in the incremental analysis ─────────────────────────

export interface StateStep {
  messageIndex: number;       // which message triggered this step (-1 = initial, -2 = latest user msg, -3 = final eval)
  role: "user" | "assistant" | "system";
  message: string;            // the message content (truncated)
  timestamp: string | null;
  previousState: ActionState;
  newState: ActionState;
  changed: boolean;           // did the state change?
  understanding: string;      // what the system understands at this point
}

export interface ConversationStateResult {
  currentState: ActionState;
  steps: StateStep[];
  stateHistory: ActionState[];
  finalInsight: string;
}

// ── Patterns ──────────────────────────────────────────────────────

const PROPOSE_PATTERNS = [
  /(?:can you|could you|please|help me)\s+(?:send|draft|schedule|reschedule|cancel|move|forward|reply)/i,
  /(?:I need to|I want to|let's)\s+(?:send|draft|schedule|reschedule|cancel|move|forward|reply)/i,
];

const DRAFT_PATTERNS = [
  /(?:here's|here is)\s+(?:a |the )?draft/i,
  /(?:I've|I have)\s+drafted/i,
  /drafted.*(?:email|message|reply)/i,
  /draft:?\s*['"]/i,
];

const ASK_CONFIRM_PATTERNS = [
  /shall I send/i, /ready to send/i, /want me to send/i,
  /should I (?:send|proceed|go ahead)/i, /confirm/i,
  /would you like me to/i,
];

const APPROVAL_PATTERNS = [
  /\b(?:yes|yep|yeah|yup)\b/i, /\bgo\s+ahead\b/i, /\bsend\s+it\b/i,
  /\bdo\s+it\b/i, /\bapprove\b/i, /\blooks\s+good\b/i, /\blgtm\b/i,
];

const HOLD_PATTERNS = [
  /hold\s+off/i, /don'?t\s+send/i, /not\s+yet/i,
  /cancel\s+that/i, /stop/i, /pause/i,
];

const CONDITION_PATTERNS = [
  /until\s+/i, /after\s+.*(?:review|approv|confirm)/i,
  /once\s+.*(?:done|complete|ready)/i, /when\s+.*(?:done|complete|ready)/i,
  /pending\s+/i,
];

const CONDITION_MET_PATTERNS = [
  /(?:legal|review|approval)\s+(?:is\s+)?(?:done|complete|cleared|approved)/i,
  /(?:got|received)\s+(?:the\s+)?(?:approval|sign.off|green.light)/i,
  /all\s+(?:clear|good|set)/i, /good\s+to\s+go/i,
];

// ── State machine with incremental understanding ──────────────────

export function analyzeConversationState(input: ScenarioInput, signals?: ComputedSignals): ConversationStateResult {
  let currentState = "IDLE" as ActionState;
  const steps: StateStep[] = [];
  const stateHistory: ActionState[] = ["IDLE" as ActionState];
  let conditionWasSet = false;
  let conditionWasResolved = false;
  let conditionText = "";
  let hadHold = false;
  let actionDescription = input.action;

  function transitionTo(
    to: ActionState,
    msgIndex: number,
    role: "user" | "assistant" | "system",
    message: string,
    timestamp: string | null,
    understanding: string,
  ) {
    const changed = to !== currentState;
    const previousState = currentState;
    if (changed) {
      currentState = to;
      stateHistory.push(to);
    }
    steps.push({
      messageIndex: msgIndex,
      role,
      message: message.length > 120 ? message.slice(0, 120) + "..." : message,
      timestamp,
      previousState,
      newState: to,
      changed,
      understanding,
    });
  }

  // ── Process each message incrementally ──────────────────────────

  for (let i = 0; i < input.conversationHistory.length; i++) {
    const msg = input.conversationHistory[i];
    const content = msg.content;
    const ts = msg.timestamp || null;

    if (msg.role === "user") {
      // Condition met
      if (CONDITION_MET_PATTERNS.some((p) => p.test(content)) && conditionWasSet && !conditionWasResolved) {
        conditionWasResolved = true;
        transitionTo("CONDITION_MET", i, "user", content, ts,
          `Precondition resolved: "${conditionText}" has been confirmed as met. Action can now proceed if user approves.`);
        continue;
      }

      // Approval
      if (APPROVAL_PATTERNS.some((p) => p.test(content))) {
        if (currentState === "CONDITION_SET") {
          transitionTo("PENDING_RELEASE", i, "user", content, ts,
            `User wants to proceed, but the precondition "${conditionText}" was never confirmed as resolved. This is risky — user may be jumping ahead.`);
        } else if (currentState === "HELD" && conditionWasSet && !conditionWasResolved) {
          transitionTo("PENDING_RELEASE", i, "user", content, ts,
            `User wants to proceed after a hold, but the condition "${conditionText}" is still unresolved.`);
        } else if (currentState === "HELD") {
          transitionTo("APPROVED", i, "user", content, ts,
            `User lifted the hold and approved. The hold had no precondition, so approval is straightforward.`);
        } else if (currentState === "CONDITION_MET") {
          transitionTo("APPROVED", i, "user", content, ts,
            `User approved after the precondition was confirmed met. All clear from a conversation standpoint.`);
        } else if (currentState === "AWAITING_APPROVAL" || currentState === "DRAFTED") {
          transitionTo("APPROVED", i, "user", content, ts,
            `User approved the proposed action. No holds or conditions — intent is clear.`);
        } else if (currentState === "PENDING_RELEASE") {
          // Stay — don't double advance
          transitionTo("PENDING_RELEASE", i, "user", content, ts,
            `User confirmed again, but the unresolved condition still blocks advancement. Repeated approval doesn't resolve the condition.`);
        }
        continue;
      }

      // Hold (with or without condition)
      if (HOLD_PATTERNS.some((p) => p.test(content))) {
        hadHold = true;
        if (CONDITION_PATTERNS.some((p) => p.test(content))) {
          conditionWasSet = true;
          // Extract condition text
          const condMatch = content.match(/until\s+(.+?)(?:\.|;|$)/i)
            || content.match(/after\s+(.+?)(?:\.|;|$)/i);
          conditionText = condMatch?.[1]?.trim() || "unspecified condition";
          transitionTo("CONDITION_SET", i, "user", content, ts,
            `Action is on HOLD with a precondition: "${conditionText}". The action cannot proceed until this condition is confirmed as met.`);
        } else {
          transitionTo("HELD", i, "user", content, ts,
            `User explicitly asked to pause/hold. Action is frozen until user lifts the hold.`);
        }
        continue;
      }

      // Condition without hold
      if (CONDITION_PATTERNS.some((p) => p.test(content))) {
        conditionWasSet = true;
        const condMatch = content.match(/until\s+(.+?)(?:\.|;|$)/i)
          || content.match(/after\s+(.+?)(?:\.|;|$)/i);
        conditionText = condMatch?.[1]?.trim() || "unspecified condition";
        transitionTo("CONDITION_SET", i, "user", content, ts,
          `Precondition set: "${conditionText}". Action is gated on this being resolved.`);
        continue;
      }

      // First user message — proposal
      if (currentState === "IDLE" && (PROPOSE_PATTERNS.some((p) => p.test(content)) || content.length > 10)) {
        actionDescription = content;
        transitionTo("PROPOSED", i, "user", content, ts,
          `User proposed an action: "${content.slice(0, 80)}". Awaiting assistant response.`);
        continue;
      }
    } else {
      // Assistant messages
      if (DRAFT_PATTERNS.some((p) => p.test(content))) {
        transitionTo("DRAFTED", i, "assistant", content, ts,
          `Assistant created a draft. Content is ready but not yet approved by user.`);
        continue;
      }
      if (ASK_CONFIRM_PATTERNS.some((p) => p.test(content))) {
        transitionTo("AWAITING_APPROVAL", i, "assistant", content, ts,
          `Assistant is asking for confirmation before acting. Waiting for user's go-ahead.`);
        continue;
      }
    }
  }

  // ── Process latest user message ─────────────────────────────────

  if (input.latestUserMessage) {
    const latest = input.latestUserMessage;
    const lastIdx = input.conversationHistory.length;

    if (CONDITION_MET_PATTERNS.some((p) => p.test(latest)) && conditionWasSet && !conditionWasResolved) {
      conditionWasResolved = true;
      transitionTo("CONDITION_MET", lastIdx, "user", latest, null,
        `Precondition "${conditionText}" resolved. Action can proceed.`);
    }

    if (APPROVAL_PATTERNS.some((p) => p.test(latest))) {
      if (currentState === "CONDITION_SET" || (currentState === "HELD" && conditionWasSet && !conditionWasResolved)) {
        transitionTo("PENDING_RELEASE", lastIdx, "user", latest, null,
          `User wants to proceed, but "${conditionText}" was never confirmed resolved. This is the riskiest state — confirmation required.`);
      } else if (currentState === "HELD") {
        transitionTo("APPROVED", lastIdx, "user", latest, null,
          `User lifted the hold. No outstanding conditions.`);
      } else if (currentState === "CONDITION_MET") {
        transitionTo("APPROVED", lastIdx, "user", latest, null,
          `User approved after precondition was resolved. Clear to proceed.`);
      } else if (currentState === "AWAITING_APPROVAL" || currentState === "DRAFTED") {
        transitionTo("APPROVED", lastIdx, "user", latest, null,
          `User approved. Intent is clear.`);
      } else if (currentState === "PENDING_RELEASE") {
        transitionTo("PENDING_RELEASE", lastIdx, "user", latest, null,
          `User confirmed again, but unresolved condition still applies.`);
      }
    }
  }

  // ── Final evaluation — apply policy and risk checks ─────────────

  if (signals?.policy_blocked) {
    transitionTo("BLOCKED", -3, "system", "Policy evaluation", null,
      `BLOCKED: This action violates policy rules. User approved in conversation, but policy overrides user intent. The action cannot proceed regardless of approval.`);
  } else if (currentState === "APPROVED") {
    const hasConflict = signals?.has_conflicting_prior_instruction ?? false;
    const hasUnresolved = signals?.unresolved_preconditions.some((p) => !p.resolved) ?? false;

    if (!hasConflict && !hasUnresolved && (!hadHold || conditionWasResolved)) {
      transitionTo("READY", -3, "system", "Final risk assessment", null,
        `All checks passed. User approved, no conflicts, no unresolved conditions, no policy violations. Action is clear to execute.`);
    } else {
      // Stay at APPROVED — add a system step explaining why not READY
      const reasons: string[] = [];
      if (hasConflict) reasons.push("conflicting instructions detected");
      if (hasUnresolved) reasons.push("unresolved precondition(s)");
      if (hadHold && !conditionWasResolved) reasons.push("prior hold may not be fully addressed");
      transitionTo("APPROVED", -3, "system", "Final risk assessment", null,
        `User approved, but risk assessment flagged: ${reasons.join(", ")}. Confirmation required before executing.`);
    }
  }

  const finalInsight = steps.length > 0 ? steps[steps.length - 1].understanding : "No conversation to analyze.";

  return { currentState, steps, stateHistory, finalInsight };
}
