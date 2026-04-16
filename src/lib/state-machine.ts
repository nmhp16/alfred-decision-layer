import { ScenarioInput, ComputedSignals } from "./schema";

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

export interface StateStep {
  messageIndex: number;
  role: "user" | "assistant" | "system";
  message: string;
  timestamp: string | null;
  previousState: ActionState;
  newState: ActionState;
  changed: boolean;
  understanding: string;
}

export interface ConversationStateResult {
  currentState: ActionState;
  steps: StateStep[];
  stateHistory: ActionState[];
  finalInsight: string;
}

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

export function analyzeConversationState(input: ScenarioInput, signals?: ComputedSignals): ConversationStateResult {
  let currentState = "IDLE" as ActionState;
  const steps: StateStep[] = [];
  const stateHistory: ActionState[] = ["IDLE" as ActionState];
  let conditionWasSet = false;
  let conditionWasResolved = false;
  let conditionText = "";
  let hadHold = false;

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

  for (let i = 0; i < input.conversationHistory.length; i++) {
    const msg = input.conversationHistory[i];
    const content = msg.content;
    const ts = msg.timestamp || null;

    if (msg.role === "user") {
      if (CONDITION_MET_PATTERNS.some((p) => p.test(content)) && conditionWasSet && !conditionWasResolved) {
        conditionWasResolved = true;
        transitionTo("CONDITION_MET", i, "user", content, ts,
          `Precondition resolved: "${conditionText}" confirmed met.`);
        continue;
      }

      if (APPROVAL_PATTERNS.some((p) => p.test(content))) {
        if (currentState === "CONDITION_SET") {
          transitionTo("PENDING_RELEASE", i, "user", content, ts,
            `User wants to proceed, but "${conditionText}" was never confirmed resolved.`);
        } else if (currentState === "HELD" && conditionWasSet && !conditionWasResolved) {
          transitionTo("PENDING_RELEASE", i, "user", content, ts,
            `User wants to proceed after hold, but "${conditionText}" is still unresolved.`);
        } else if (currentState === "HELD") {
          transitionTo("APPROVED", i, "user", content, ts,
            `User lifted the hold. No precondition was set.`);
        } else if (currentState === "CONDITION_MET") {
          transitionTo("APPROVED", i, "user", content, ts,
            `User approved after precondition was confirmed met.`);
        } else if (currentState === "AWAITING_APPROVAL" || currentState === "DRAFTED") {
          transitionTo("APPROVED", i, "user", content, ts,
            `User approved. No holds or conditions.`);
        } else if (currentState === "PENDING_RELEASE") {
          transitionTo("PENDING_RELEASE", i, "user", content, ts,
            `Repeated approval doesn't resolve the unresolved condition.`);
        }
        continue;
      }

      if (HOLD_PATTERNS.some((p) => p.test(content))) {
        hadHold = true;
        if (CONDITION_PATTERNS.some((p) => p.test(content))) {
          conditionWasSet = true;
          const condMatch = content.match(/until\s+(.+?)(?:\.|;|$)/i)
            || content.match(/after\s+(.+?)(?:\.|;|$)/i);
          conditionText = condMatch?.[1]?.trim() || "unspecified condition";
          transitionTo("CONDITION_SET", i, "user", content, ts,
            `Hold with precondition: "${conditionText}".`);
        } else {
          transitionTo("HELD", i, "user", content, ts,
            `User explicitly paused the action.`);
        }
        continue;
      }

      if (CONDITION_PATTERNS.some((p) => p.test(content))) {
        conditionWasSet = true;
        const condMatch = content.match(/until\s+(.+?)(?:\.|;|$)/i)
          || content.match(/after\s+(.+?)(?:\.|;|$)/i);
        conditionText = condMatch?.[1]?.trim() || "unspecified condition";
        transitionTo("CONDITION_SET", i, "user", content, ts,
          `Precondition set: "${conditionText}".`);
        continue;
      }

      if (currentState === "IDLE" && (PROPOSE_PATTERNS.some((p) => p.test(content)) || content.length > 10)) {
        transitionTo("PROPOSED", i, "user", content, ts,
          `User proposed an action.`);
        continue;
      }
    } else {
      if (DRAFT_PATTERNS.some((p) => p.test(content))) {
        transitionTo("DRAFTED", i, "assistant", content, ts,
          `Assistant created a draft. Not yet approved.`);
        continue;
      }
      if (ASK_CONFIRM_PATTERNS.some((p) => p.test(content))) {
        transitionTo("AWAITING_APPROVAL", i, "assistant", content, ts,
          `Assistant asking for confirmation.`);
        continue;
      }
    }
  }

  // Process latest user message
  if (input.latestUserMessage) {
    const latest = input.latestUserMessage;
    const lastIdx = input.conversationHistory.length;

    if (CONDITION_MET_PATTERNS.some((p) => p.test(latest)) && conditionWasSet && !conditionWasResolved) {
      conditionWasResolved = true;
      transitionTo("CONDITION_MET", lastIdx, "user", latest, null,
        `Precondition "${conditionText}" resolved.`);
    }

    if (APPROVAL_PATTERNS.some((p) => p.test(latest))) {
      if (currentState === "CONDITION_SET" || (currentState === "HELD" && conditionWasSet && !conditionWasResolved)) {
        transitionTo("PENDING_RELEASE", lastIdx, "user", latest, null,
          `User wants to proceed, but "${conditionText}" was never confirmed resolved.`);
      } else if (currentState === "HELD") {
        transitionTo("APPROVED", lastIdx, "user", latest, null,
          `User lifted the hold.`);
      } else if (currentState === "CONDITION_MET") {
        transitionTo("APPROVED", lastIdx, "user", latest, null,
          `Approved after precondition resolved.`);
      } else if (currentState === "AWAITING_APPROVAL" || currentState === "DRAFTED") {
        transitionTo("APPROVED", lastIdx, "user", latest, null,
          `User approved.`);
      } else if (currentState === "PENDING_RELEASE") {
        transitionTo("PENDING_RELEASE", lastIdx, "user", latest, null,
          `Repeated approval, unresolved condition still applies.`);
      }
    }
  }

  // Final evaluation — apply policy and risk checks
  if (signals?.policy_blocked) {
    transitionTo("BLOCKED", -3, "system", "Policy evaluation", null,
      `BLOCKED: Policy violation. Cannot proceed regardless of approval.`);
  } else if (currentState === "APPROVED") {
    const hasConflict = signals?.has_conflicting_prior_instruction ?? false;
    const hasUnresolved = signals?.unresolved_preconditions.some((p) => !p.resolved) ?? false;

    if (!hasConflict && !hasUnresolved && (!hadHold || conditionWasResolved)) {
      transitionTo("READY", -3, "system", "Final risk assessment", null,
        `All checks passed. Clear to execute.`);
    } else {
      const reasons: string[] = [];
      if (hasConflict) reasons.push("conflicting instructions");
      if (hasUnresolved) reasons.push("unresolved precondition(s)");
      if (hadHold && !conditionWasResolved) reasons.push("prior hold may not be fully addressed");
      transitionTo("APPROVED", -3, "system", "Final risk assessment", null,
        `Approved but flagged: ${reasons.join(", ")}. Confirmation required.`);
    }
  }

  const finalInsight = steps.length > 0 ? steps[steps.length - 1].understanding : "No conversation to analyze.";

  return { currentState, steps, stateHistory, finalInsight };
}
