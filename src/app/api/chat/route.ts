import { createUIMessageStreamResponse } from "ai";
import { connection } from "next/server";
import { ChatRequestSchema } from "@/lib/chat";
import { ChatBusyError, streamChatTurn } from "@/server/agent/agent";
import { chatDeps } from "@/server/agent/deps";
import { db } from "@/server/db/client";
import { getTrip } from "@/server/trips/trips";

/**
 * POST /api/chat (F6): one chat turn, streamed as AI SDK UI message chunks. Errors are short
 * plain-text messages the chat panel shows as they are.
 */
export async function POST(request: Request): Promise<Response> {
  await connection();
  const body: unknown = await request.json().catch(() => null);
  const parsed = ChatRequestSchema.safeParse(body);
  if (!parsed.success) return text(parsed.error.issues[0].message, 400);
  const { tripId, text: message, history } = parsed.data;
  if (tripId && !getTrip(db, tripId)) return text("Trip not found.", 404);

  try {
    const stream = await streamChatTurn(chatDeps, {
      tripId,
      text: message,
      history,
      signal: request.signal,
    });
    return createUIMessageStreamResponse({ stream });
  } catch (err) {
    if (err instanceof ChatBusyError) return text(err.message, 409);
    console.error("Chat turn could not start", err);
    return text("The assistant is unavailable right now. Please try again.", 503);
  }
}

function text(body: string, status: number): Response {
  return new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
