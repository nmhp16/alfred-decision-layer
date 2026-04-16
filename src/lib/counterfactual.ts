import { ScenarioInput, ComputedSignals } from "./schema";
import { computeSignals } from "./signals";
import { deterministicDecision } from "./decision-engine";

export interface Counterfactual {
  id: string;
  label: string;
  modification: string;
  originalDecision: string;
  newDecision: string;
  changed: boolean;
  originalConfidence: number;
  newConfidence: number;
  insight: string;
}

export function runCounterfactuals(input: ScenarioInput, originalSignals: ComputedSignals): Counterfactual[] {
  const originalResult = deterministicDecision(originalSignals);
  const originalDecision = originalResult.decision.decision;
  const counterfactuals: Counterfactual[] = [];

  // Remove all hold/wait messages
  const holdPatterns = [/hold\s+off/i, /wait/i, /don'?t\s+send/i, /pause/i, /stop/i, /not\s+yet/i, /until\s+/i];
  const hasHoldMessages = input.conversationHistory.some(
    (m) => m.role === "user" && holdPatterns.some((p) => p.test(m.content))
  );
  if (hasHoldMessages) {
    const modifiedInput = {
      ...input,
      conversationHistory: input.conversationHistory.filter(
        (m) => !(m.role === "user" && holdPatterns.some((p) => p.test(m.content)))
      ),
    };
    const newSignals = computeSignals(modifiedInput);
    const newResult = deterministicDecision(newSignals);
    counterfactuals.push({
      id: "remove-hold",
      label: "Remove \"hold off\" messages",
      modification: "Removed all hold/wait/pause messages from conversation history",
      originalDecision,
      newDecision: newResult.decision.decision,
      changed: newResult.decision.decision !== originalDecision,
      originalConfidence: originalSignals.confidence,
      newConfidence: newSignals.confidence,
      insight: newResult.decision.decision !== originalDecision
        ? `The hold messages are the reason the system chose "${originalDecision}" instead of "${newResult.decision.decision}". Without them, the action would proceed more freely.`
        : `Even without the hold messages, the decision stays the same. Other risk factors are driving this.`,
    });
  }

  // Remove all approval messages
  const approvalPatterns = [/yes/i, /yep/i, /go\s+ahead/i, /send\s+it/i, /do\s+it/i, /approve/i, /looks\s+good/i];
  const hasApprovalMessages = input.conversationHistory.some(
    (m) => m.role === "user" && approvalPatterns.some((p) => p.test(m.content))
  );
  if (hasApprovalMessages) {
    const modifiedInput = {
      ...input,
      conversationHistory: input.conversationHistory.filter(
        (m) => !(m.role === "user" && approvalPatterns.some((p) => p.test(m.content)))
      ),
    };
    const newSignals = computeSignals(modifiedInput);
    const newResult = deterministicDecision(newSignals);
    counterfactuals.push({
      id: "remove-approval",
      label: "Remove approval messages",
      modification: "Removed all yes/approve/send-it messages from conversation history",
      originalDecision,
      newDecision: newResult.decision.decision,
      changed: newResult.decision.decision !== originalDecision,
      originalConfidence: originalSignals.confidence,
      newConfidence: newSignals.confidence,
      insight: newResult.decision.decision !== originalDecision
        ? `The approval messages affect the decision. Without them, the conflicting instruction detection changes.`
        : `Removing approvals doesn't change the decision — other factors dominate.`,
    });
  }

  // Make it internal (remove external indicators)
  if (originalSignals.is_external_facing) {
    const externalTerms = /external|partner|client|vendor|recruiter|contractor|@\w+\.\w+/gi;
    const modifiedInput = {
      ...input,
      action: input.action.replace(externalTerms, "team-member"),
      conversationHistory: input.conversationHistory.map((m) => ({
        ...m,
        content: m.content.replace(externalTerms, "team-member"),
      })),
    };
    const newSignals = computeSignals(modifiedInput);
    const newResult = deterministicDecision(newSignals);
    counterfactuals.push({
      id: "make-internal",
      label: "Make action internal",
      modification: "Replaced external recipients with internal team members",
      originalDecision,
      newDecision: newResult.decision.decision,
      changed: newResult.decision.decision !== originalDecision,
      originalConfidence: originalSignals.confidence,
      newConfidence: newSignals.confidence,
      insight: newResult.decision.decision !== originalDecision
        ? `The external-facing nature of this action is a key driver. An equivalent internal action would be "${newResult.decision.decision}".`
        : `Even as an internal action, the decision stays the same. External-facing is not the primary risk factor.`,
    });
  }

  // Remove sensitive content
  if (originalSignals.contains_sensitive_domain) {
    const sensitiveTerms = /\b(?:pricing|discount|salary|compensation|confidential|nda|legal|contract|restricted|proprietary|personal)\b/gi;
    const modifiedInput = {
      ...input,
      action: input.action.replace(sensitiveTerms, "general"),
      latestUserMessage: input.latestUserMessage.replace(sensitiveTerms, "general"),
      conversationHistory: input.conversationHistory.map((m) => ({
        ...m,
        content: m.content.replace(sensitiveTerms, "general"),
      })),
    };
    const newSignals = computeSignals(modifiedInput);
    const newResult = deterministicDecision(newSignals);
    counterfactuals.push({
      id: "remove-sensitive",
      label: "Remove sensitive content",
      modification: "Replaced sensitive keywords (pricing, salary, etc.) with neutral terms",
      originalDecision,
      newDecision: newResult.decision.decision,
      changed: newResult.decision.decision !== originalDecision,
      originalConfidence: originalSignals.confidence,
      newConfidence: newSignals.confidence,
      insight: newResult.decision.decision !== originalDecision
        ? `Sensitive content is driving extra caution. Without it, the decision would be "${newResult.decision.decision}".`
        : `Sensitive content alone isn't changing the decision — other risk factors are present.`,
    });
  }

  // Resolve ambiguity
  if (!originalSignals.entity_resolved) {
    const modifiedInput = {
      ...input,
      latestUserMessage: input.latestUserMessage + " — specifically the first one",
      action: input.action + " (specifically identified)",
    };
    const newSignals = computeSignals(modifiedInput);
    const newResult = deterministicDecision(newSignals);
    counterfactuals.push({
      id: "resolve-ambiguity",
      label: "Resolve entity ambiguity",
      modification: "Added specificity to disambiguate the referenced entity",
      originalDecision,
      newDecision: newResult.decision.decision,
      changed: newResult.decision.decision !== originalDecision,
      originalConfidence: originalSignals.confidence,
      newConfidence: newSignals.confidence,
      insight: newResult.decision.decision !== originalDecision
        ? `Ambiguity is the blocker. Once the entity is clear, the decision moves to "${newResult.decision.decision}".`
        : `Even with clear entities, other factors keep the decision at "${originalDecision}".`,
    });
  }

  // Remove conversation history entirely (one-shot)
  if (input.conversationHistory.length > 0) {
    const modifiedInput = {
      ...input,
      conversationHistory: [],
    };
    const newSignals = computeSignals(modifiedInput);
    const newResult = deterministicDecision(newSignals);
    counterfactuals.push({
      id: "no-history",
      label: "Remove conversation history",
      modification: "Evaluate action with no conversation context (one-shot)",
      originalDecision,
      newDecision: newResult.decision.decision,
      changed: newResult.decision.decision !== originalDecision,
      originalConfidence: originalSignals.confidence,
      newConfidence: newSignals.confidence,
      insight: newResult.decision.decision !== originalDecision
        ? `Conversation history matters. Without it, the decision changes to "${newResult.decision.decision}" — proving this is a contextual decision, not one-shot classification.`
        : `The decision is the same with or without history. The action's intrinsic properties drive the outcome.`,
    });
  }

  return counterfactuals;
}
