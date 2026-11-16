import "server-only";
import { headers } from "next/headers";
import { db } from "@/server/db/client";
import { env } from "@/server/env";
import { aiActionLimits, clientIp, consumeRateLimits, tooManyRequests } from "./policies";

/**
 * Rate limit for Server Actions that may call the LLM (LLM10). Returns the message to show
 * when the client is over its limit, or null when the action may run.
 */
export async function limitAiAction(): Promise<string | null> {
  const result = consumeRateLimits(db, aiActionLimits(env, clientIp(await headers())));
  return result.ok ? null : tooManyRequests(result.retryAt);
}
