import type { UIMessage } from "ai";
import { z } from "zod";

/**
 * Chat contract (F6) shared by the /api/chat route and the chat panel. The client sends only
 * the new message: a trip's conversation lives in the server-side checkpointer. The home page
 * has no trip yet, so its (short) history travels with each request instead.
 */

/** LLM01: longer messages are rejected before they reach the model. */
export const MAX_CHAT_INPUT = 500;
/** Home-page turns kept and sent back with each request (there is no thread yet). */
export const MAX_HOME_HISTORY = 10;
/** Assistant replies are short; longer history entries are cut. */
export const MAX_HISTORY_TEXT = 2000;

export const TRIP_VIEWS = ["swipe", "review", "itinerary"] as const;
export type TripView = (typeof TRIP_VIEWS)[number];

/**
 * Data part sent when a tool changed the trip: the client refreshes the visual area, or opens
 * `view` when the change is shown there (a new trip, a new itinerary).
 */
export type TripUpdate = { tripId: string; view?: TripView };

export type ChatMessage = UIMessage<never, { "trip-updated": TripUpdate }>;

export const ChatRequestSchema = z.object({
  /** Absent on the home page, before a trip exists. */
  tripId: z.uuid().optional(),
  text: z.string().trim().min(1, "Type a message.").max(MAX_CHAT_INPUT, "Message too long."),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        text: z.string().max(MAX_HISTORY_TEXT),
      }),
    )
    .max(MAX_HOME_HISTORY)
    .default([]),
});
export type ChatRequest = z.input<typeof ChatRequestSchema>;
export type ChatHistoryEntry = z.infer<typeof ChatRequestSchema>["history"][number];

/** Plain text of a message (text parts only; tool and data parts are not part of the history). */
export function messageText(message: Pick<ChatMessage, "parts">): string {
  return message.parts
    .flatMap((p) => (p.type === "text" ? [p.text] : []))
    .join("")
    .trim();
}

/** The last home-page turns, as sent with the next request. */
export function toHomeHistory(messages: readonly ChatMessage[]): ChatHistoryEntry[] {
  return messages
    .flatMap((m) => {
      const text = messageText(m);
      const role = m.role === "user" ? "user" : "assistant";
      return text ? [{ role, text: text.slice(0, MAX_HISTORY_TEXT) } as const] : [];
    })
    .slice(-MAX_HOME_HISTORY);
}

/** Where a trip update should take the user; only paths of this app, built from a UUID. */
export function tripUpdatePath(update: TripUpdate): string | null {
  if (!update.view || !z.uuid().safeParse(update.tripId).success) return null;
  return `/trip/${update.tripId}/${update.view}`;
}
