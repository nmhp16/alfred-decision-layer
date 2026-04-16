import { ScenarioInput, ComputedSignals } from "./schema";

// ── Action lifecycle states ────────────────────────────────────────
// Tracks WHERE an action is in its lifecycle. States can go forward
// OR backward — a hold reverts progress, an unresolved condition
// blocks advancement.

export type ActionState =
  | "IDLE"              // no action proposed yet
  | "PROPOSED"          // user or assistant suggested an action
  | "DRAFTED"           // assistant created a draft
  | "AWAITING_APPROVAL" // assistant asked for confirmation
  | "APPROVED"          // user approved with no outstanding issues
  | "HELD"              // user said hold off / wait (simple hold, no condition)
  | "CONDITION_SET"     // user set a precondition ("until legal reviews")
  | "CONDITION_MET"     // precondition was confirmed resolved
  | "PENDING_RELEASE"   // user wants to proceed after a hold, but condition is unresolved
  | "READY";            // all clear — approved with no blocks

export interface StateTransition {
  from: ActionState;
  to: ActionState;
  trigger: string;
  messageIndex: number;
  timestamp: string | null;
}

export interface ConversationStateResult {
  currentState: ActionState;
  transitions: StateTransition[];
  stateHistory: ActionState[];
  insight: string;
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

// ── State machine ─────────────────────────────────────────────────

export function analyzeConversationState(input: ScenarioInput, signals?: ComputedSignals): ConversationStateResult {
  let currentState = "IDLE" as ActionState;
  const transitions: StateTransition[] = [];
  const stateHistory: ActionState[] = ["IDLE" as ActionState];
  // Track whether a condition was set and whether it was resolved
  let conditionWasSet = false;
  let conditionWasResolved = false;
  let hadHold = false;

  function transition(to: ActionState, trigger: string, index: number, ts: string | null) {
    if (to !== currentState) {
      transitions.push({ from: currentState, to, trigger, messageIndex: index, timestamp: ts });
      currentState = to;
      stateHistory.push(to);
    }
  }

  // Process conversation history
  for (let i = 0; i < input.conversationHistory.length; i++) {
    const msg = input.conversationHistory[i];
    const content = msg.content;
    const ts = msg.timestamp || null;

    if (msg.role === "user") {
      // Check condition met FIRST (before approval, because "all clear, send it" is both)
      if (CONDITION_MET_PATTERNS.some((p) => p.test(content))) {
        if (conditionWasSet && !conditionWasResolved) {
          conditionWasResolved = true;
          transition("CONDITION_MET", content, i, ts);
          continue;
        }
      }

      // User approving
      if (APPROVAL_PATTERNS.some((p) => p.test(content))) {
        if (currentState === "CONDITION_SET") {
          // Approval after condition set WITHOUT resolution → PENDING_RELEASE
          transition("PENDING_RELEASE", content, i, ts);
        } else if (currentState === "HELD") {
          // Simple hold (no condition) → user lifts it
          if (conditionWasSet && !conditionWasResolved) {
            transition("PENDING_RELEASE", content, i, ts);
          } else {
            transition("APPROVED", content, i, ts);
          }
        } else if (currentState === "CONDITION_MET") {
          // Condition was resolved, now user approves → APPROVED
          transition("APPROVED", content, i, ts);
        } else if (currentState === "AWAITING_APPROVAL" || currentState === "DRAFTED") {
          transition("APPROVED", content, i, ts);
        } else if (currentState === "PENDING_RELEASE") {
          // Already pending — don't double-advance
          // Stay at PENDING_RELEASE
        }
        continue;
      }

      // User holding — this REVERTS progress
      if (HOLD_PATTERNS.some((p) => p.test(content))) {
        hadHold = true;
        if (CONDITION_PATTERNS.some((p) => p.test(content))) {
          // Hold WITH condition
          conditionWasSet = true;
          transition("CONDITION_SET", content, i, ts);
        } else {
          transition("HELD", content, i, ts);
        }
        continue;
      }

      // User setting a condition without explicit hold
      if (CONDITION_PATTERNS.some((p) => p.test(content))) {
        conditionWasSet = true;
        transition("CONDITION_SET", content, i, ts);
        continue;
      }

      // If idle and user is making any request
      if (currentState === "IDLE" && content.length > 10) {
        transition("PROPOSED", content, i, ts);
      }
    } else {
      // Assistant messages
      if (DRAFT_PATTERNS.some((p) => p.test(content))) {
        transition("DRAFTED", content, i, ts);
        continue;
      }
      if (ASK_CONFIRM_PATTERNS.some((p) => p.test(content))) {
        transition("AWAITING_APPROVAL", content, i, ts);
        continue;
      }
    }
  }

  // Process the latest user message
  if (input.latestUserMessage) {
    const latest = input.latestUserMessage;
    const lastIdx = input.conversationHistory.length;

    // Check condition met first
    if (CONDITION_MET_PATTERNS.some((p) => p.test(latest))) {
      if (conditionWasSet && !conditionWasResolved) {
        conditionWasResolved = true;
        transition("CONDITION_MET", latest, lastIdx, null);
      }
    }

    if (APPROVAL_PATTERNS.some((p) => p.test(latest))) {
      if (currentState === "CONDITION_SET" || (currentState === "HELD" && conditionWasSet && !conditionWasResolved)) {
        // Condition unresolved — can't advance past PENDING_RELEASE
        transition("PENDING_RELEASE", latest, lastIdx, null);
      } else if (currentState === "HELD") {
        // Simple hold lifted
        transition("APPROVED", latest, lastIdx, null);
      } else if (currentState === "CONDITION_MET") {
        transition("APPROVED", latest, lastIdx, null);
      } else if (currentState === "AWAITING_APPROVAL" || currentState === "DRAFTED") {
        transition("APPROVED", latest, lastIdx, null);
      } else if (currentState === "PENDING_RELEASE") {
        // Already pending — stay there, don't double-advance
      }
      // Don't advance from PENDING_RELEASE to APPROVED — that requires condition resolution
    }
  }

  // Determine READY — only when APPROVED with zero outstanding issues
  if (currentState === "APPROVED") {
    const policyBlocked = signals?.policy_blocked ?? false;
    const hasConflict = signals?.has_conflicting_prior_instruction ?? false;
    const hasUnresolved = signals?.unresolved_preconditions.some((p) => !p.resolved) ?? false;

    if (!policyBlocked && !hasConflict && !hasUnresolved && (!hadHold || conditionWasResolved)) {
      currentState = "READY" as ActionState;
      stateHistory.push("READY" as ActionState);
    }
  }

  const insight = generateInsight(currentState, stateHistory, signals, conditionWasSet, conditionWasResolved);

  return { currentState, transitions, stateHistory, insight };
}

// ── Insight generation ────────────────────────────────────────────

function generateInsight(
  state: ActionState,
  _history: ActionState[],
  signals?: ComputedSignals,
  conditionWasSet?: boolean,
  conditionWasResolved?: boolean,
): string {
  // Policy override
  if (signals?.policy_blocked) {
    return "User approved in conversation, but this action is BLOCKED by policy. User intent does not override policy.";
  }

  switch (state) {
    case "IDLE":
      return "No action has been proposed in this conversation.";
    case "PROPOSED":
      return "Action was proposed but not yet drafted or confirmed.";
    case "DRAFTED":
      return "A draft was created but the user hasn't approved it yet.";
    case "AWAITING_APPROVAL":
      return "The assistant asked for confirmation. Waiting for the user's response.";
    case "APPROVED":
      // Approved but not READY — something is still flagged by signals
      if (signals?.has_conflicting_prior_instruction) {
        return "User approved, but conflicting instructions were detected in conversation. Confirmation required to verify intent.";
      }
      if (signals?.unresolved_preconditions.some((p) => !p.resolved)) {
        return "User approved, but an unresolved precondition exists. Confirmation required.";
      }
      return "User approved. Awaiting final risk assessment.";
    case "READY":
      return "User approved with no outstanding issues. Action is clear to proceed.";
    case "HELD":
      return "User explicitly asked to hold/pause. Action should NOT proceed until the hold is lifted.";
    case "CONDITION_SET":
      return "User set a precondition that must be met before proceeding. Waiting for confirmation that the condition is resolved.";
    case "CONDITION_MET":
      return "A prior condition was set and has been confirmed as resolved. Awaiting user approval to proceed.";
    case "PENDING_RELEASE":
      if (conditionWasSet && !conditionWasResolved) {
        return "User wants to proceed, but a prior condition was NEVER confirmed as met. The system cannot verify whether the condition was resolved offline — confirmation required.";
      }
      return "User wants to proceed after a hold. The hold reason may or may not be addressed — confirmation required.";
    default:
      return "Unknown conversation state.";
  }
}
