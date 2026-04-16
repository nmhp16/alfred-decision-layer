import { ScenarioInput, ComputedSignals, Precondition } from "./schema";

// ── Action type classification ─────────────────────────────────────

const ACTION_TYPES: Record<string, { irreversible: boolean; externalFacing: boolean; requiredParams: string[] }> = {
  send_email: { irreversible: true, externalFacing: true, requiredParams: ["recipient", "subject"] },
  reply_email: { irreversible: true, externalFacing: true, requiredParams: ["recipient"] },
  forward_email: { irreversible: true, externalFacing: true, requiredParams: ["recipient"] },
  schedule_meeting: { irreversible: false, externalFacing: false, requiredParams: ["time", "attendees"] },
  reschedule_meeting: { irreversible: false, externalFacing: false, requiredParams: ["meeting_id", "new_time"] },
  cancel_meeting: { irreversible: true, externalFacing: true, requiredParams: ["meeting_id"] },
  set_reminder: { irreversible: false, externalFacing: false, requiredParams: ["content", "time"] },
  complete_reminder: { irreversible: false, externalFacing: false, requiredParams: [] },
  move_calendar_event: { irreversible: false, externalFacing: false, requiredParams: ["event_id", "new_time"] },
  draft_email: { irreversible: false, externalFacing: false, requiredParams: ["recipient"] },
};

const SENSITIVE_KEYWORDS = [
  /\bpricing\b/i, /\bdiscount\b/i, /\bsalary\b/i, /\bcompensation\b/i, /\bconfidential\b/i,
  /\bnda\b/i, /\blegal\b/i, /\bcontract\b/i, /\binternal only\b/i, /\brestricted\b/i,
  /\bproprietary\b/i, /\btrade secret\b/i, /\bpersonal\b/i, /\bssn\b/i, /\bpassword\b/i,
];

const HOLD_PATTERNS = [
  /hold\s+off/i, /wait/i, /don'?t\s+send/i, /pause/i, /stop/i,
  /not\s+yet/i, /cancel\s+that/i, /until\s+.*\s+review/i,
];

const APPROVAL_PATTERNS = [
  /yes/i, /yep/i, /go\s+ahead/i, /send\s+it/i, /do\s+it/i,
  /confirm/i, /approve/i, /looks\s+good/i, /lgtm/i,
];

const EXTERNAL_INDICATORS = [
  "external", "partner", "client", "vendor", "recruiter",
  "outside", "third.party", "@", "acme", "contractor",
];

// ── Precondition patterns ─────────────────────────────────────────
// Matches "until X reviews Y", "after X approves", "once X is done", "when X confirms"
const PRECONDITION_PATTERNS = [
  /until\s+(.+?)\s+review/i,
  /until\s+(.+?)\s+approv/i,
  /until\s+(.+?)\s+confirm/i,
  /after\s+(.+?)\s+review/i,
  /after\s+(.+?)\s+approv/i,
  /after\s+(.+?)\s+confirm/i,
  /once\s+(.+?)\s+(?:is\s+)?(?:done|complete|ready|finished)/i,
  /when\s+(.+?)\s+(?:is\s+)?(?:done|complete|ready|finished)/i,
  /pending\s+(.+?)(?:\s+review|\s+approval)?$/i,
];

// Patterns that indicate a precondition was resolved
const RESOLUTION_PATTERNS = [
  /(?:legal|review|approval)\s+(?:is\s+)?(?:done|complete|cleared|approved|finished|good)/i,
  /(?:got|received)\s+(?:the\s+)?(?:approval|sign.off|green.light)/i,
  /(?:legal|team|manager)\s+(?:said|confirmed|approved|signed.off)/i,
  /all\s+(?:clear|good|set)/i,
  /good\s+to\s+go/i,
];

const POLICY_BLOCKED_PATTERNS = [
  { test: (action: string, context: string) =>
    /confidential|internal\s+only|restricted/i.test(context) &&
    /forward|send|share/i.test(action) &&
    isExternalContext(action, context) },
  { test: (action: string, context: string) =>
    /salary|compensation|ssn|password/i.test(context) &&
    /forward|send|share/i.test(action) &&
    isExternalContext(action, context) },
];

function isExternalContext(action: string, context: string): boolean {
  const combined = `${action} ${context}`.toLowerCase();
  return EXTERNAL_INDICATORS.some((ind) => combined.includes(ind));
}

// ── Detect action type from text ───────────────────────────────────

function detectActionType(action: string): string {
  const a = action.toLowerCase();
  if (/complete|mark.*done|finish.*reminder/i.test(a)) return "complete_reminder";
  if (/forward/i.test(a)) return "forward_email";
  if (/reply/i.test(a)) return "reply_email";
  if (/send.*email|email.*send/i.test(a)) return "send_email";
  if (/send.*draft|draft.*send/i.test(a)) return "send_email";
  if (/reschedule/i.test(a)) return "reschedule_meeting";
  if (/cancel.*meeting/i.test(a)) return "cancel_meeting";
  if (/move.*meeting|move.*event|move.*standup/i.test(a)) return "move_calendar_event";
  if (/schedule|set.*meeting/i.test(a)) return "schedule_meeting";
  if (/reminder|remind/i.test(a)) return "set_reminder";
  if (/draft/i.test(a)) return "draft_email";
  return "unknown";
}

// ── Timestamp parsing ──────────────────────────────────────────────

function parseTimestamp(ts: string | undefined): Date | null {
  if (!ts) return null;
  const d = new Date(ts);
  if (isNaN(d.getTime())) {
    // Try common formats like "2024-01-15 09:00"
    const match = ts.match(/(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})/);
    if (match) return new Date(`${match[1]}T${match[2]}:00`);
    return null;
  }
  return d;
}

function minutesBetween(a: Date, b: Date): number {
  return Math.abs(a.getTime() - b.getTime()) / 60000;
}

// ── Main signal computation ────────────────────────────────────────

export function computeSignals(input: ScenarioInput): ComputedSignals {
  const actionType = detectActionType(input.action);
  const actionConfig = ACTION_TYPES[actionType];
  const allText = [
    input.action,
    input.latestUserMessage,
    ...input.conversationHistory.map((m) => m.content),
  ].join(" ");

  // Intent resolution
  const intent_resolved = actionType !== "unknown" && input.action.length > 5;

  // Entity resolution
  const ambiguousPatterns = [
    /\bthe meeting\b/i, /\bthe draft\b/i, /\bthe email\b/i,
    /\bthat one\b/i, /\bthe event\b/i, /\bwhich one\b/i,
  ];
  const msg = input.latestUserMessage.toLowerCase();
  const hasAmbiguousRef = ambiguousPatterns.some((p) => p.test(msg));
  const multipleEntitiesMentioned = /multiple|several|3\s+meetings/i.test(allText);
  const entity_resolved = !hasAmbiguousRef && !multipleEntitiesMentioned;

  // Missing required params
  const missing_required_params: string[] = [];
  if (actionConfig) {
    for (const param of actionConfig.requiredParams) {
      const paramKeywords: Record<string, RegExp> = {
        recipient: /to\s+\w|@|recipient|send\s+to/i,
        subject: /subject|about|re:/i,
        time: /\d{1,2}(:\d{2})?\s*(am|pm)|tomorrow|today|monday|tuesday|wednesday|thursday|friday/i,
        new_time: /\d{1,2}(:\d{2})?\s*(am|pm)|tomorrow|today|monday|tuesday|wednesday|thursday|friday/i,
        meeting_id: /standup|sync|meeting|call|1:1|one.on.one/i,
        event_id: /standup|sync|meeting|event|call/i,
        attendees: /with\s+\w|team|everyone/i,
        content: /.{3,}/i,
      };
      if (paramKeywords[param] && !paramKeywords[param].test(allText)) {
        missing_required_params.push(param);
      }
    }
  }

  // ── Temporal analysis ────────────────────────────────────────────
  // Find the "now" reference point (latest message timestamp or current time)
  const lastMsg = input.conversationHistory[input.conversationHistory.length - 1];
  const now = parseTimestamp(lastMsg?.timestamp) || new Date();

  // Find most recent hold and approval messages with timestamps
  const holdMessages = input.conversationHistory.filter(
    (m) => m.role === "user" && HOLD_PATTERNS.some((p) => p.test(m.content))
  );
  const approvalMessages = input.conversationHistory.filter(
    (m) => m.role === "user" && APPROVAL_PATTERNS.some((p) => p.test(m.content))
  );

  const has_prior_explicit_approval = approvalMessages.length > 0;
  const has_conflicting_prior_instruction =
    holdMessages.length > 0 && approvalMessages.length > 0;

  // Temporal: how recently did hold/approval happen?
  let hold_recency_minutes: number | null = null;
  if (holdMessages.length > 0) {
    const lastHold = holdMessages[holdMessages.length - 1];
    const holdTime = parseTimestamp(lastHold.timestamp);
    if (holdTime) hold_recency_minutes = Math.round(minutesBetween(now, holdTime));
  }

  let approval_recency_minutes: number | null = null;
  if (approvalMessages.length > 0) {
    const lastApproval = approvalMessages[approvalMessages.length - 1];
    const approvalTime = parseTimestamp(lastApproval.timestamp);
    if (approvalTime) approval_recency_minutes = Math.round(minutesBetween(now, approvalTime));
  }

  // ── Precondition tracking ────────────────────────────────────────
  const unresolved_preconditions: Precondition[] = [];
  for (const m of input.conversationHistory) {
    if (m.role !== "user") continue;
    for (const pattern of PRECONDITION_PATTERNS) {
      const match = m.content.match(pattern);
      if (match) {
        const condition = match[1]?.trim() || match[0];
        const mTime = parseTimestamp(m.timestamp);

        // Check if any later message resolved this precondition
        const mIndex = input.conversationHistory.indexOf(m);
        const laterMessages = input.conversationHistory.slice(mIndex + 1);
        const resolved = laterMessages.some(
          (later) => RESOLUTION_PATTERNS.some((rp) => rp.test(later.content))
        );

        unresolved_preconditions.push({
          condition,
          sourceMessage: m.content,
          resolved,
          ageMinutes: mTime ? Math.round(minutesBetween(now, mTime)) : null,
        });
      }
    }
  }

  // External facing
  const is_external_facing = actionConfig?.externalFacing ?? isExternalContext(input.action, allText);

  // Irreversible
  const is_irreversible = actionConfig?.irreversible ?? false;

  // Affects others
  const AFFECTS_OTHERS_PATTERNS = [
    /attendee/i, /participant/i, /team/i, /standup/i, /sync/i,
    /1:1/i, /one.on.one/i, /meeting/i, /call\b/i, /review\b/i,
    /send.*to/i, /forward.*to/i, /reply/i, /cc\b/i, /bcc\b/i,
    /invite/i, /schedule.*with/i, /cancel.*meeting/i,
  ];
  const affects_others = is_external_facing ||
    AFFECTS_OTHERS_PATTERNS.some((p) => p.test(allText));

  // Sensitive domain
  const contains_sensitive_domain = SENSITIVE_KEYWORDS.some((kw) => kw.test(allText));

  // Policy blocked
  const policy_blocked = POLICY_BLOCKED_PATTERNS.some((p) => p.test(input.action, allText));

  // Risk score (0-1 weighted composite)
  let risk_score = 0;
  if (!intent_resolved) risk_score += 0.2;
  if (!entity_resolved) risk_score += 0.15;
  if (missing_required_params.length > 0) risk_score += 0.1 * missing_required_params.length;
  if (has_conflicting_prior_instruction) risk_score += 0.2;
  if (is_external_facing) risk_score += 0.15;
  if (is_irreversible) risk_score += 0.1;
  if (contains_sensitive_domain) risk_score += 0.15;
  if (policy_blocked) risk_score += 0.3;
  // Unresolved preconditions add risk
  const hasUnresolved = unresolved_preconditions.some((p) => !p.resolved);
  if (hasUnresolved) risk_score += 0.25;
  risk_score = Math.min(1, Math.round(risk_score * 100) / 100);

  // ── Confidence scoring ───────────────────────────────────────────
  // How confident is the deterministic engine in its own decision?
  let confidence = 0;
  const confidence_factors: string[] = [];

  // High confidence cases: signals clearly point to one answer
  if (policy_blocked) {
    confidence = 0.99;
    confidence_factors.push("Policy block is definitive — always refuse");
  } else if (!intent_resolved || !entity_resolved || missing_required_params.length > 0) {
    confidence = 0.95;
    confidence_factors.push("Missing info is objectively detectable — always clarify");
  } else if (risk_score < 0.1 && !affects_others && !is_irreversible) {
    confidence = 0.9;
    confidence_factors.push("All signals indicate safe silent execution");
  } else if (risk_score < 0.15 && affects_others && !is_external_facing) {
    confidence = 0.85;
    confidence_factors.push("Low risk + affects others = notify (clear boundary)");
  } else {
    // Ambiguous zone — this is where the LLM adds value
    confidence = 0.3; // low base
    confidence_factors.push("Risk signals are mixed — judgment call needed");

    // Temporal context can increase or decrease confidence
    if (has_conflicting_prior_instruction && hasUnresolved) {
      confidence = 0.4;
      confidence_factors.push("Conflicting instructions + unresolved precondition → likely confirm, but context matters");
    } else if (has_conflicting_prior_instruction && !hasUnresolved) {
      confidence = 0.5;
      confidence_factors.push("Hold was given but no active precondition — user may have resolved it offline");
    }

    // Fresh approval with stale hold increases confidence in approval
    if (hold_recency_minutes !== null && approval_recency_minutes !== null) {
      if (approval_recency_minutes < hold_recency_minutes) {
        confidence += 0.1;
        confidence_factors.push(`Approval is more recent (${approval_recency_minutes}m ago) than hold (${hold_recency_minutes}m ago)`);
      } else {
        confidence -= 0.1;
        confidence_factors.push(`Hold is more recent (${hold_recency_minutes}m ago) than approval (${approval_recency_minutes}m ago) — suspicious`);
      }
    }

    // Very high risk is clearer
    if (risk_score >= 0.6) {
      confidence = Math.max(confidence, 0.75);
      confidence_factors.push(`High risk score (${risk_score}) makes confirm more certain`);
    }
  }

  confidence = Math.max(0, Math.min(1, Math.round(confidence * 100) / 100));

  return {
    intent_resolved,
    entity_resolved,
    missing_required_params,
    has_prior_explicit_approval,
    has_conflicting_prior_instruction,
    is_external_facing,
    is_irreversible,
    affects_others,
    contains_sensitive_domain,
    risk_score,
    policy_blocked,
    hold_recency_minutes,
    approval_recency_minutes,
    unresolved_preconditions,
    confidence,
    confidence_factors,
  };
}
