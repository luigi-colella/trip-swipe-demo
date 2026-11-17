import { Chat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import {
  messageText,
  toHomeHistory,
  type ChatMessage,
  type ChatRequest,
  type TripUpdate,
} from "@/lib/chat";
import { defined } from "@/lib/invariant";

/**
 * Chat sessions outlive the panel: the panel remounts when the layout switches between the
 * desktop aside and the mobile sheet, and the conversation must survive client navigations.
 * One session per trip (plus one for the home page), kept for the lifetime of the page.
 */
export type ChatSession = {
  chat: Chat<ChatMessage>;
  /** The trip the requests act on; a trip created from this chat binds it to the new trip. */
  tripId: string | null;
  /** Whether the trip's earlier conversation was loaded (or does not need loading). */
  historyLoaded: boolean;
  /** Set by the mounted panel: applies trip updates to the visual area. */
  onUpdate?: (update: TripUpdate) => void;
};

const HOME = "home";
const sessions = new Map<string, ChatSession>();

function createSession(tripId: string | null): ChatSession {
  const session: ChatSession = { tripId, historyLoaded: tripId === null } as ChatSession;
  session.chat = new Chat<ChatMessage>({
    transport: new DefaultChatTransport<ChatMessage>({
      api: "/api/chat",
      // Only the new message travels: a trip's conversation lives on the server.
      prepareSendMessagesRequest: ({ messages }) => {
        const body: ChatRequest = {
          tripId: session.tripId ?? undefined,
          text: messageText(defined(messages.at(-1), "the message being sent")),
          history: session.tripId ? [] : toHomeHistory(messages.slice(0, -1)),
        };
        return { body };
      },
    }),
    // `trip-updated` is the only data part the server sends.
    onData: ({ data }) => {
      if (data.tripId !== session.tripId) bindToTrip(session, data.tripId);
      session.onUpdate?.(data);
    },
  });
  return session;
}

export function getChatSession(tripId: string | null): ChatSession {
  const key = tripId ?? HOME;
  let session = sessions.get(key);
  if (!session) {
    session = createSession(tripId);
    sessions.set(key, session);
  }
  return session;
}

/** A trip created from the chat continues the same conversation (also on the server). */
export function bindToTrip(session: ChatSession, tripId: string): void {
  sessions.delete(session.tripId ?? HOME);
  session.tripId = tripId;
  session.historyLoaded = true;
  sessions.set(tripId, session);
}

/** Lets the mounted panel apply trip updates; returns the unsubscribe function. */
export function onTripUpdate(session: ChatSession, apply: (update: TripUpdate) => void) {
  session.onUpdate = apply;
  return () => {
    if (session.onUpdate === apply) session.onUpdate = undefined;
  };
}

/** Shows the trip's earlier conversation, unless the user already started a new one. */
export async function loadHistory(
  session: ChatSession,
  load: (tripId: string) => Promise<ChatMessage[]>,
): Promise<void> {
  try {
    const history = await load(defined(session.tripId, "the trip of the conversation"));
    if (session.chat.messages.length === 0) session.chat.messages = history;
  } catch (err) {
    console.error("Could not load the conversation", err);
  } finally {
    session.historyLoaded = true;
  }
}

/** Forgets every session (tests). */
export function resetChatSessions(): void {
  sessions.clear();
}
