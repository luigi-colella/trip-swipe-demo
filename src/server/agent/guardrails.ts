import { applyStrategy, resolveRedactionRule } from "langchain";

/**
 * Deterministic chat guardrails (§2.1): known prompt-injection and prompt-extraction patterns
 * get a standard refusal without calling the model (LLM01, LLM07), and personal data is
 * redacted before it reaches the model or the checkpointer (LLM02). Heuristics only catch the
 * obvious cases; the real protection is structural (trip bound server-side, allow-listed
 * tools, call limits), so the patterns favour precision over recall.
 */

export type GuardrailHit = "prompt-injection" | "prompt-extraction";

const INJECTION_PATTERNS: readonly RegExp[] = [
  // "ignore all previous instructions", "disregard the rules above", "forget your prompt"
  /\b(?:ignore|disregard|forget|override|bypass)\b[^.!?\n]{0,40}\b(?:instructions?|rules|prompts?|guidelines|directives|guardrails)\b/i,
  // "you are now DAN", "from now on you are…"
  /\byou are now\b|\bfrom now on,? you (?:are|will)\b/i,
  /\b(?:developer|dan|god|admin|sudo|unrestricted) mode\b/i,
  /\bjailbr(?:ea|o)k/i,
  /\bdo anything now\b/i,
  // Chat-template and role markers pasted into the message.
  /<\|?\s*(?:im_start|im_end|system|endoftext)\s*\|?>|\[\/?(?:INST|SYS)\]|<<\/?SYS>>/i,
  /^\s*#*\s*(?:system|developer)\s*(?:prompt|message)?\s*:/im,
  /\bnew (?:instructions|rules|system prompt)\s*:/i,
];

const EXTRACTION_PATTERNS: readonly RegExp[] = [
  /\bsystem (?:prompt|message|instructions)\b/i,
  // "show me your instructions", "what are your rules" (not "the rules for visiting…")
  /\b(?:reveal|show|print|repeat|output|display|tell me|give me|what (?:are|were|is)|share|leak|dump)\b[^.!?\n]{0,30}\b(?:your|initial|hidden|original|secret)\s+(?:instructions|rules|prompt|guidelines|configuration)\b/i,
  /\b(?:repeat|print|output)\b[^.!?\n]{0,20}\b(?:everything|the text|all text|words)\b[^.!?\n]{0,20}\babove\b/i,
];

/** The guardrail a message trips, if any. */
export function detectPromptAttack(text: string): GuardrailHit | null {
  if (INJECTION_PATTERNS.some((p) => p.test(text))) return "prompt-injection";
  if (EXTRACTION_PATTERNS.some((p) => p.test(text))) return "prompt-extraction";
  return null;
}

export const GUARDRAIL_REPLIES: Record<GuardrailHit, string> = {
  "prompt-injection":
    "I can't do that. I can only help with this trip: ask me to add or remove places, move them between days or plan a new itinerary.",
  "prompt-extraction":
    "I can't share how I'm set up, but I'm happy to help with your trip: ask me to add or remove places, move them between days or plan a new itinerary.",
};

/**
 * Personal data redacted from chat messages: the built-in detectors plus phone numbers
 * (9+ digits, optionally with +, spaces, dots, dashes or parentheses).
 */
const PII_RULES = [
  { piiType: "email" },
  { piiType: "credit_card" },
  { piiType: "ip" },
  { piiType: "phone", detector: "\\+?\\d(?:[\\s().-]?\\d){8,14}" },
] as const;

const resolvedRules = PII_RULES.map((rule) =>
  resolveRedactionRule({ ...rule, strategy: "redact" }),
);

/**
 * Redacts personal data with LangChain's PII detectors (the ones behind its piiMiddleware).
 * Applied to every user message before the agent runs, so personal data reaches neither the
 * model nor the checkpointer, at no cost in graph steps.
 */
export function redactPii(text: string): string {
  return resolvedRules.reduce((out, rule) => {
    const matches = rule.detector(out);
    return matches.length ? applyStrategy(out, matches, "redact", rule.piiType) : out;
  }, text);
}
