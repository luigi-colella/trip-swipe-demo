import { createUIMessageStreamResponse } from "ai";
import { connection } from "next/server";
import { ChatRequestSchema } from "@/lib/chat";
import { ChatBusyError, streamChatTurn } from "@/server/agent/agent";
import { AI_PAUSED_MESSAGE } from "@/lib/ai-busy";
import { chatDeps } from "@/server/agent/deps";
import { llmBudget } from "@/server/ai/runtime";
import { db } from "@/server/db/client";
import { env } from "@/server/env";
import { chatLimits, clientIp, consumeRateLimits, tooManyRequests } from "@/server/limits/policies";
import { getTrip } from "@/server/trips/trips";

/**
 * POST /api/chat (F6): one chat turn, streamed as AI SDK UI message chunks. Errors are short
 * plain-text messages the chat panel shows as they are. Turns are rate limited per client and
 * per trip, and refused up front while the daily LLM budget is used up (LLM10).
 */
export async function POST(request: Request): Promise<Response> {
  await connection();
  const body: unknown = await request.json().catch(() => null);
  const parsed = ChatRequestSchema.safeParse(body);
  if (!parsed.success) return text(parsed.error.issues[0].message, 400);
  const { tripId, text: message, history } = parsed.data;
  if (tripId && !getTrip(db, tripId)) return text("Trip not found.", 404);
  const limited = consumeRateLimits(db, chatLimits(env, clientIp(request.headers), tripId));
  if (!limited.ok) return text(tooManyRequests(limited.retryAt), 429);
  if (llmBudget.exhausted()) return text(AI_PAUSED_MESSAGE, 503);

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
