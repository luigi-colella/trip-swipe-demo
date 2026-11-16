import type { AppDatabase } from "@/server/db/connection";
import type { Env } from "@/server/env-schema";
import {
  consumeRateLimit,
  DAY_MS,
  HOUR_MS,
  retryIn,
  type RateLimit,
  type RateLimitResult,
} from "./rate-limits";

/**
 * Per-client limits (LLM10): chat turns per IP and per trip, and the actions that may call the
 * LLM (new trip, "Load more", planning) per IP. Limits come from the environment.
 */

type LimitEnv = Pick<
  Env,
  "RATE_LIMIT_CHAT_PER_HOUR" | "RATE_LIMIT_CHAT_PER_TRIP_PER_DAY" | "RATE_LIMIT_AI_ACTIONS_PER_HOUR"
>;

export function chatLimits(env: LimitEnv, ip: string, tripId?: string): RateLimit[] {
  return [
    { key: `chat:ip:${ip}`, limit: env.RATE_LIMIT_CHAT_PER_HOUR, windowMs: HOUR_MS },
    ...(tripId
      ? [
          {
            key: `chat:trip:${tripId}`,
            limit: env.RATE_LIMIT_CHAT_PER_TRIP_PER_DAY,
            windowMs: DAY_MS,
          },
        ]
      : []),
  ];
}

export function aiActionLimits(env: LimitEnv, ip: string): RateLimit[] {
  return [{ key: `ai:ip:${ip}`, limit: env.RATE_LIMIT_AI_ACTIONS_PER_HOUR, windowMs: HOUR_MS }];
}

/** Consumes each limit in turn and stops at the first one that refuses. */
export function consumeRateLimits(
  db: AppDatabase,
  limits: readonly RateLimit[],
  now = new Date(),
): RateLimitResult {
  for (const limit of limits) {
    const result = consumeRateLimit(db, limit, now);
    if (!result.ok) return result;
  }
  return { ok: true };
}

/**
 * The client's address. `next start` fills x-forwarded-for from the socket when the request
 * has none; a client can still send its own, which is acceptable for a local demo.
 */
export function clientIp(headers: Pick<Headers, "get">): string {
  return headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
}

export function tooManyRequests(retryAt: Date, now = new Date()): string {
  return `Too many requests. Please try again ${retryIn(retryAt, now)}.`;
}
