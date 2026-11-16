"use server";

import type { ChatMessage } from "@/lib/chat";
import { TripIdSchema } from "@/lib/trip-schemas";
import { db } from "@/server/db/client";
import { chatDeps } from "@/server/agent/deps";
import { loadChatHistory } from "@/server/agent/history";
import { getTrip } from "@/server/trips/trips";

/** F6: the trip's conversation, when its chat is opened (empty for unknown trips). */
export async function loadChatHistoryAction(tripId: string): Promise<ChatMessage[]> {
  const id = TripIdSchema.safeParse(tripId);
  if (!id.success || !getTrip(db, id.data)) return [];
  return loadChatHistory(chatDeps.checkpointer, id.data);
}
