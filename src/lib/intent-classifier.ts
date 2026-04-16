export interface IntentMatch {
  type: string;
  confidence: number;
  matchQuality: "strong" | "weak" | "none";
  matchedTokens: string[];
  negated: boolean;
}

export interface ClassificationResult {
  best: IntentMatch;
  ranked: IntentMatch[];
}

interface IntentDef {
  verbs: string[];
  objects: string[];
  phrases: string[];
  negative: string[];
}

const INTENTS: Record<string, IntentDef> = {
  send_email: {
    verbs: ["send", "email", "deliver", "dispatch", "fire off"],
    objects: ["email", "message", "mail", "note"],
    phrases: ["send email", "send message", "send it", "send the", "fire off", "email to"],
    negative: ["draft", "schedule", "remind", "cancel"],
  },
  reply_email: {
    verbs: ["reply", "respond", "answer", "write back", "get back"],
    objects: ["email", "message", "thread", "mail"],
    phrases: ["reply to", "respond to", "write back", "get back to", "reply email", "answer email"],
    negative: ["forward", "draft", "schedule"],
  },
  forward_email: {
    verbs: ["forward", "fwd", "pass along", "share"],
    objects: ["email", "message", "mail", "thread", "spreadsheet", "document", "data"],
    phrases: ["forward to", "forward email", "forward the", "pass along", "fwd to", "share with"],
    negative: ["reply", "draft", "schedule"],
  },
  draft_email: {
    verbs: ["draft", "compose", "write", "prepare", "create"],
    objects: ["email", "message", "mail", "note", "reply", "response"],
    phrases: ["draft email", "draft a", "compose email", "write email", "prepare email", "draft message"],
    negative: ["send", "forward", "cancel"],
  },
  schedule_meeting: {
    verbs: ["schedule", "book", "set up", "arrange", "create", "organize"],
    objects: ["meeting", "call", "sync", "standup", "session", "appointment", "1:1", "one-on-one"],
    phrases: ["schedule meeting", "book meeting", "set up meeting", "schedule a", "book a call", "arrange meeting", "set meeting"],
    negative: ["cancel", "reschedule", "move", "delete"],
  },
  reschedule_meeting: {
    verbs: ["reschedule", "postpone", "push back", "delay", "change time"],
    objects: ["meeting", "call", "sync", "standup", "session", "appointment", "1:1"],
    phrases: ["reschedule meeting", "reschedule my", "postpone meeting", "push back", "change time", "move to"],
    negative: ["cancel", "schedule new", "book"],
  },
  cancel_meeting: {
    verbs: ["cancel", "delete", "remove", "drop", "kill"],
    objects: ["meeting", "call", "sync", "standup", "session", "appointment", "1:1", "event"],
    phrases: ["cancel meeting", "cancel the", "delete meeting", "drop the meeting", "cancel call"],
    negative: ["schedule", "reschedule", "book"],
  },
  move_calendar_event: {
    verbs: ["move", "shift", "push", "bump", "relocate"],
    objects: ["meeting", "event", "standup", "sync", "call", "calendar", "1:1", "appointment"],
    phrases: ["move to", "push to", "shift to", "bump to", "move my", "move the", "push my"],
    negative: ["cancel", "delete", "schedule new"],
  },
  set_reminder: {
    verbs: ["remind", "set", "create", "add", "alert"],
    objects: ["reminder", "alert", "notification", "alarm", "todo"],
    phrases: ["set reminder", "remind me", "create reminder", "set a reminder", "add reminder", "remind about"],
    negative: ["complete", "done", "finish", "mark", "cancel"],
  },
  complete_reminder: {
    verbs: ["complete", "finish", "mark", "done", "check off", "close", "resolve"],
    objects: ["reminder", "task", "todo", "item"],
    phrases: ["mark done", "mark completed", "mark as done", "mark as completed", "complete reminder",
              "finish reminder", "done with", "check off", "mark reminder"],
    negative: ["set", "create", "add", "schedule"],
  },
};

const STOP_WORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "shall", "can", "i", "me", "my", "we",
  "our", "you", "your", "it", "its", "this", "that", "these", "those",
  "of", "in", "on", "at", "for", "with", "as", "by", "from", "into",
  "just", "also", "so", "very", "too", "really", "please", "thanks",
  "okay", "ok", "sure", "yeah", "yep", "yes", "no", "hey", "hi",
]);

// Negation scope: next 3 tokens after a negation word are marked negated
const NEGATION_WORDS = new Set([
  "not", "no", "don't", "dont", "doesn't", "doesnt", "didn't", "didnt",
  "won't", "wont", "wouldn't", "wouldnt", "can't", "cant", "cannot",
  "shouldn't", "shouldnt", "never", "stop", "halt",
]);

interface TokenInfo {
  token: string;
  negated: boolean;
  position: number;
}

function tokenize(text: string): TokenInfo[] {
  const normalized = text
    .toLowerCase()
    .replace(/[^a-z0-9'\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const rawTokens = normalized.split(" ").filter(Boolean);
  const result: TokenInfo[] = [];
  let negationScope = 0;

  for (let i = 0; i < rawTokens.length; i++) {
    const raw = rawTokens[i];

    if (NEGATION_WORDS.has(raw)) {
      negationScope = 3;
      continue;
    }

    const negated = negationScope > 0;
    if (negationScope > 0) negationScope--;

    if (STOP_WORDS.has(raw)) continue;

    result.push({ token: raw, negated, position: i });
  }

  return result;
}

function generateNgrams(tokens: TokenInfo[]): string[] {
  const ngrams: string[] = [];
  for (let i = 0; i < tokens.length - 1; i++) {
    ngrams.push(`${tokens[i].token} ${tokens[i + 1].token}`);
  }
  for (let i = 0; i < tokens.length - 2; i++) {
    ngrams.push(`${tokens[i].token} ${tokens[i + 1].token} ${tokens[i + 2].token}`);
  }
  return ngrams;
}

const WEIGHTS = {
  phraseMatch: 0.35,
  verbMatch: 0.30,
  objectMatch: 0.20,
  negativeMatch: -0.25,
  negation: -0.40,
};

function scoreIntent(intentId: string, def: IntentDef, tokens: TokenInfo[], ngrams: string[]): IntentMatch {
  let score = 0;
  const matchedTokens: string[] = [];
  let primaryVerbNegated = false;

  // Phrase matching (bigrams/trigrams)
  let phraseHits = 0;
  for (const phrase of def.phrases) {
    if (ngrams.some((ng) => ng.includes(phrase) || phrase.includes(ng))) {
      phraseHits++;
      matchedTokens.push(`phrase:"${phrase}"`);
    }
  }
  if (phraseHits > 0) {
    score += WEIGHTS.phraseMatch * Math.min(1, 0.6 + 0.3 * Math.min(phraseHits, 3) / 3);
  }

  // Verb matching
  let verbHits = 0;
  for (const verb of def.verbs) {
    const verbTokens = verb.split(" ");
    for (const t of tokens) {
      if (verbTokens.includes(t.token)) {
        verbHits++;
        matchedTokens.push(`verb:"${t.token}"`);
        if (t.negated) primaryVerbNegated = true;
      }
    }
  }
  if (verbHits > 0) {
    score += WEIGHTS.verbMatch * Math.min(1, verbHits / 2);
  }

  // Object matching
  let objectHits = 0;
  for (const obj of def.objects) {
    const objTokens = obj.split(/[-\s]/);
    for (const t of tokens) {
      if (objTokens.includes(t.token)) {
        objectHits++;
        matchedTokens.push(`obj:"${t.token}"`);
      }
    }
  }
  if (objectHits > 0) {
    score += WEIGHTS.objectMatch * Math.min(1, objectHits / 2);
  }

  // Negative token penalty (disambiguation)
  let negHits = 0;
  for (const neg of def.negative) {
    const negTokens = neg.split(" ");
    for (const t of tokens) {
      if (negTokens.includes(t.token) && !t.negated) {
        negHits++;
        matchedTokens.push(`neg:"${t.token}"`);
      }
    }
  }
  if (negHits > 0) {
    score += WEIGHTS.negativeMatch * Math.min(1, negHits / 2);
  }

  // Negation penalty
  if (primaryVerbNegated) {
    score += WEIGHTS.negation;
    matchedTokens.push("NEGATED");
  }

  const confidence = Math.max(0, Math.min(1, score));

  let matchQuality: "strong" | "weak" | "none";
  if (confidence >= 0.4 && phraseHits > 0) {
    matchQuality = "strong";
  } else if (confidence >= 0.15) {
    matchQuality = "weak";
  } else {
    matchQuality = "none";
  }

  return {
    type: intentId,
    confidence: Math.round(confidence * 1000) / 1000,
    matchQuality,
    matchedTokens: [...new Set(matchedTokens)],
    negated: primaryVerbNegated,
  };
}

export function classifyIntent(text: string): ClassificationResult {
  const tokens = tokenize(text);
  const ngrams = generateNgrams(tokens);

  const ranked = Object.entries(INTENTS)
    .map(([id, def]) => scoreIntent(id, def, tokens, ngrams))
    .sort((a, b) => b.confidence - a.confidence);

  const best = ranked[0];

  if (!best || best.confidence < 0.1) {
    return {
      best: {
        type: "unknown",
        confidence: 0,
        matchQuality: "none",
        matchedTokens: [],
        negated: false,
      },
      ranked,
    };
  }

  // Close contest between top two → downgrade quality
  if (ranked.length >= 2) {
    const gap = best.confidence - ranked[1].confidence;
    if (gap < 0.05 && best.matchQuality === "strong") {
      best.matchQuality = "weak";
    }
  }

  return { best, ranked };
}

export interface ActionDetection {
  type: string;
  matchQuality: "strong" | "weak" | "none";
}

export function detectActionType(action: string): ActionDetection {
  const result = classifyIntent(action);
  return {
    type: result.best.type,
    matchQuality: result.best.matchQuality,
  };
}
