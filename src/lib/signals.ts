import { ScenarioInput, ComputedSignals } from "./schema";

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
  "pricing", "discount", "salary", "compensation", "confidential",
  "nda", "legal", "contract", "internal only", "restricted",
  "proprietary", "trade secret", "personal", "ssn", "password",
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

// ── Main signal computation ────────────────────────────────────────

export function computeSignals(input: ScenarioInput): ComputedSignals {
  const actionType = detectActionType(input.action);
  const actionConfig = ACTION_TYPES[actionType];
  const allText = [
    input.action,
    input.latestUserMessage,
    ...input.conversationHistory.map((m) => m.content),
  ].join(" ");

  // Intent resolution: do we know what the user wants to do?
  const intent_resolved = actionType !== "unknown" && input.action.length > 5;

  // Entity resolution: are referenced entities unambiguous?
  // Use word-boundary regex to avoid false positives (e.g., "it" inside "with")
  const ambiguousPatterns = [
    /\bthe meeting\b/i,
    /\bthe draft\b/i,
    /\bthe email\b/i,
    /\bthat one\b/i,
    /\bthe event\b/i,
    /\bwhich one\b/i,
  ];
  const msg = input.latestUserMessage.toLowerCase();
  const hasAmbiguousRef = ambiguousPatterns.some((p) => p.test(msg));
  const multipleEntitiesMentioned = /multiple|several|3\s+meetings/i.test(allText);
  const entity_resolved = !hasAmbiguousRef && !multipleEntitiesMentioned;

  // Missing required params
  const missing_required_params: string[] = [];
  if (actionConfig) {
    for (const param of actionConfig.requiredParams) {
      // Simple heuristic: check if the param concept appears anywhere in context
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

  // Prior approval: scan conversation for explicit confirmation
  const has_prior_explicit_approval = input.conversationHistory.some(
    (m) => m.role === "user" && APPROVAL_PATTERNS.some((p) => p.test(m.content))
  );

  // Conflicting instructions: check if user said hold off AND later said go ahead
  const holdMessages = input.conversationHistory.filter(
    (m) => m.role === "user" && HOLD_PATTERNS.some((p) => p.test(m.content))
  );
  const approvalMessages = input.conversationHistory.filter(
    (m) => m.role === "user" && APPROVAL_PATTERNS.some((p) => p.test(m.content))
  );
  const has_conflicting_prior_instruction =
    holdMessages.length > 0 && approvalMessages.length > 0;

  // External facing
  const is_external_facing = actionConfig?.externalFacing ?? isExternalContext(input.action, allText);

  // Irreversible
  const is_irreversible = actionConfig?.irreversible ?? false;

  // Sensitive domain
  const contains_sensitive_domain = SENSITIVE_KEYWORDS.some((kw) =>
    allText.toLowerCase().includes(kw)
  );

  // Policy blocked
  const policy_blocked = POLICY_BLOCKED_PATTERNS.some((p) =>
    p.test(input.action, allText)
  );

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
  risk_score = Math.min(1, Math.round(risk_score * 100) / 100);

  return {
    intent_resolved,
    entity_resolved,
    missing_required_params,
    has_prior_explicit_approval,
    has_conflicting_prior_instruction,
    is_external_facing,
    is_irreversible,
    contains_sensitive_domain,
    risk_score,
    policy_blocked,
  };
}
