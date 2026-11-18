import { createUIMessageStreamResponse } from "ai";
import { connection } from "next/server";
import { ChatRequestSchema } from "@/lib/chat";
import { ChatBusyError, isClientAbort, streamChatTurn } from "@/server/agent/agent";
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
  // Bounded before parsing: the largest valid request (message + home history) is ~21k
  // characters, so anything far beyond it is refused without being read (or parsed) in full.
  if (Number(request.headers.get("content-length")) > MAX_CHAT_BODY_CHARS * 4) {
    return text(REQUEST_TOO_LARGE, 413);
  }
  const raw = await request.text();
  if (raw.length > MAX_CHAT_BODY_CHARS) return text(REQUEST_TOO_LARGE, 413);
  const body = parseJson(raw);
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
    // A client that left before the run started is not a failure worth an error log.
    if (!isClientAbort(err, request.signal)) console.error("Chat turn could not start", err);
    return text("The assistant is unavailable right now. Please try again.", 503);
  }
}

/** Generous for valid requests even with every character escaped in the JSON. */
export const MAX_CHAT_BODY_CHARS = 128 * 1024;
const REQUEST_TOO_LARGE = "Request too large.";

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function text(body: string, status: number): Response {
  return new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
