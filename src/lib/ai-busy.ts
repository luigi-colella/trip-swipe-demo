/**
 * User-facing copy for "AI is busy" (§7): the app's daily LLM budget or the provider's free
 * quota is used up. Everything that does not need the model keeps working.
 */

/** The daily budget is used up: AI features are back after 00:00 UTC. */
export const AI_PAUSED_TITLE = "AI is busy";
export const AI_PAUSED_MESSAGE =
  "Today's free AI quota is used up, so new cities, more places and AI planning are paused until tomorrow. Saved cities, swiping and itinerary edits still work.";

/** The provider is rate limiting right now (usually per minute). */
export const AI_BUSY_MESSAGE = "The AI is busy right now. Please try again in a minute.";
