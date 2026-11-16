import { and, eq, lt, sql } from "drizzle-orm";
import type { AppDatabase } from "@/server/db/connection";
import { rateLimits } from "@/server/db/schema";

/**
 * Fixed-window counters in the `rate_limits` table (LLM10): per-client rate limits and the
 * daily LLM budget. Windows are aligned to the epoch (an hour window starts on the hour, a
 * day window at 00:00 UTC). Plain synchronous SQLite: safe for one Node process.
 */

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;
/** Counters of windows that ended this long ago are deleted. */
const KEEP_MS = 2 * DAY_MS;

export type RateLimit = { key: string; limit: number; windowMs: number };
export type RateLimitResult = { ok: true } | { ok: false; retryAt: Date };

export function windowStart(windowMs: number, now: Date): number {
  return Math.floor(now.getTime() / windowMs) * windowMs;
}

/** Uses so far in the current window. */
export function windowCount(db: AppDatabase, key: string, windowMs: number, now: Date): number {
  const row = db
    .select({ count: rateLimits.count })
    .from(rateLimits)
    .where(and(eq(rateLimits.key, key), eq(rateLimits.windowStart, windowStart(windowMs, now))))
    .get();
  return row?.count ?? 0;
}

/**
 * Adds `amount` uses to the current window, or raises the count to `atLeast`. Never refuses:
 * used to record what already happened.
 */
export function addToWindow(
  db: AppDatabase,
  key: string,
  windowMs: number,
  now: Date,
  { amount = 1, atLeast = 0 }: { amount?: number; atLeast?: number } = {},
): void {
  const start = windowStart(windowMs, now);
  db.insert(rateLimits)
    .values({ key, windowStart: start, count: Math.max(amount, atLeast) })
    .onConflictDoUpdate({
      target: [rateLimits.key, rateLimits.windowStart],
      set: { count: sql`max(${rateLimits.count} + ${amount}, ${atLeast})` },
    })
    .run();
}

/**
 * Counts one use if the limit allows it; otherwise reports when the window ends. Refused
 * attempts are not counted, so a client that keeps retrying is not locked out for longer.
 */
export function consumeRateLimit(
  db: AppDatabase,
  { key, limit, windowMs }: RateLimit,
  now = new Date(),
): RateLimitResult {
  const start = windowStart(windowMs, now);
  db.delete(rateLimits)
    .where(lt(rateLimits.windowStart, now.getTime() - KEEP_MS))
    .run();
  const counted =
    limit > 0 &&
    db
      .insert(rateLimits)
      .values({ key, windowStart: start, count: 1 })
      .onConflictDoUpdate({
        target: [rateLimits.key, rateLimits.windowStart],
        set: { count: sql`${rateLimits.count} + 1` },
        setWhere: lt(rateLimits.count, limit),
      })
      .returning({ count: rateLimits.count })
      .get() !== undefined;
  return counted ? { ok: true } : { ok: false, retryAt: new Date(start + windowMs) };
}

/** "in 1 minute", "in 25 minutes", "in 2 hours": when a refused client may try again. */
export function retryIn(retryAt: Date, now = new Date()): string {
  const minutes = Math.max(1, Math.ceil((retryAt.getTime() - now.getTime()) / 60_000));
  if (minutes < 120) return `in ${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  return `in ${Math.round(minutes / 60)} hours`;
}
