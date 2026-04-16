import { ScenarioInput } from "./schema";
import { detectActionType } from "./intent-classifier";

export interface ReconstructedAction {
  actionType: string;
  what: string;
  who: string[];
  content: string | null;
  conditions: string[];
  reconstructedFrom: string[];
}

const RECIPIENT_PATTERNS = [
  /(?:to|@)\s+(\S+@\S+)/i,
  /(?:send|reply|forward)\s+(?:to|it to)\s+(\w[\w\s]*?)(?:\s+(?:about|regarding|with)|\.|,|$)/i,
  /(?:email|message)\s+(\w[\w\s]*?)(?:\s+(?:about|regarding)|\.|,|$)/i,
  /(?:partner|client|vendor)\s+(?:at\s+)?(\w[\w\s]*?)(?:\.|,|$)/i,
];

const CONTENT_PATTERNS = [
  /(?:draft|drafted|here's a draft)[:\s]*['"](.+?)['"]/i,
  /(?:draft|drafted|here's)[:\s]*(.{20,}?)(?:\.\s*(?:shall|should|want|ready)|$)/i,
  /'([^']{15,})'/,
  /"([^"]{15,})"/,
];

const SUBJECT_PATTERNS = [
  /(?:about|regarding|re:)\s+(.+?)(?:\.|,|$)/i,
  /(?:proposing|proposal for|offer)\s+(.+?)(?:\.|,|$)/i,
  /(?:discount|pricing|terms)\s+(.+?)(?:\.|,|$)/i,
];

const ENTITY_PATTERNS = [
  /(?:the\s+)?(\d{1,2}(?::\d{2})?\s*(?:am|pm)\s+\w[\w\s]*?)(?:\s+to\b|\.|,|$)/i,
  /(?:reminder|meeting|event|call|standup|sync)[:\s]+['"]?(.+?)['"]?(?:\.|,|$)/i,
  /(?:mark|complete)\s+(?:the\s+)?['"]?(.+?)['"]?\s+(?:as\s+)?(?:done|completed)/i,
];

export function reconstructAction(input: ScenarioInput): ReconstructedAction {
  const allMessages = [
    ...input.conversationHistory.map((m) => m.content),
    input.latestUserMessage,
  ];
  const reconstructedFrom: string[] = [];

  // Detect action type using NLP classifier
  const actionType = detectActionType(input.action).type;

  // Extract WHAT
  let what = input.action;
  for (const msg of allMessages) {
    for (const p of ENTITY_PATTERNS) {
      const match = msg.match(p);
      if (match?.[1] && match[1].length > 3) {
        what = match[1].trim();
        reconstructedFrom.push(`Entity "${what}" from: "${truncate(msg, 60)}"`);
        break;
      }
    }
  }

  // Extract WHO
  const who: string[] = [];
  for (const msg of [input.action, ...allMessages]) {
    for (const p of RECIPIENT_PATTERNS) {
      const match = msg.match(p);
      if (match?.[1]) {
        const recipient = match[1].trim();
        if (!who.includes(recipient) && recipient.length > 1) {
          who.push(recipient);
          reconstructedFrom.push(`Recipient "${recipient}" from: "${truncate(msg, 60)}"`);
        }
      }
    }
  }

  // Extract CONTENT (from assistant drafts)
  let content: string | null = null;
  for (const msg of input.conversationHistory) {
    if (msg.role === "assistant") {
      for (const p of CONTENT_PATTERNS) {
        const match = msg.content.match(p);
        if (match?.[1] && match[1].length > 10) {
          content = match[1].trim();
          reconstructedFrom.push(`Content from assistant draft: "${truncate(content, 80)}"`);
          break;
        }
      }
    }
  }

  if (!content) {
    for (const msg of allMessages) {
      for (const p of SUBJECT_PATTERNS) {
        const match = msg.match(p);
        if (match?.[1] && match[1].length > 3) {
          content = match[1].trim();
          reconstructedFrom.push(`Subject "${content}" from: "${truncate(msg, 60)}"`);
          break;
        }
      }
      if (content) break;
    }
  }

  // Extract CONDITIONS
  const conditions: string[] = [];
  const conditionPatterns = [
    /until\s+(.+?)(?:\.|;|,\s*(?:a|I|and)|$)/i,
    /after\s+(.+?(?:review|approv|confirm)\w*)(?:\.|;|,|$)/i,
    /once\s+(.+?(?:done|complete|ready|finished))(?:\.|;|,|$)/i,
    /pending\s+(.+?)(?:\.|;|,|$)/i,
  ];
  for (const msg of allMessages) {
    for (const p of conditionPatterns) {
      const match = msg.match(p);
      if (match?.[1] && match[1].length > 3) {
        const cond = match[1].trim();
        if (!conditions.includes(cond)) {
          conditions.push(cond);
          reconstructedFrom.push(`Condition "${cond}" from: "${truncate(msg, 60)}"`);
        }
      }
    }
  }

  return {
    actionType,
    what,
    who,
    content,
    conditions,
    reconstructedFrom,
  };
}

function truncate(s: string, len: number): string {
  return s.length > len ? s.slice(0, len) + "..." : s;
}
