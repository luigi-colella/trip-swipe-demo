import { eq, lte } from "drizzle-orm";
import type { AppDatabase } from "@/server/db/connection";
import { httpCache } from "@/server/db/schema";

/** Dependencies of the places layer; tests pass a temporary database and a fixed clock. */
export type HttpDeps = {
  db: AppDatabase;
  now?: () => Date;
};

/** Wikimedia and Photon ask clients to identify themselves; no personal contact data here. */
export const USER_AGENT = "TravelSwipeAI/0.1 (local demo app)";
const DEFAULT_TIMEOUT_MS = 10_000;

export const DAY_MS = 24 * 60 * 60 * 1000;

export class HttpError extends Error {
  constructor(
    readonly url: string,
    readonly status: number,
  ) {
    super(`HTTP ${status} for ${new URL(url).host}`);
    this.name = "HttpError";
  }
}

export async function fetchJson(url: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<unknown> {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new HttpError(url, res.status);
  return res.json();
}

export function readHttpCache(db: AppDatabase, key: string, now: Date): unknown | undefined {
  const row = db.select().from(httpCache).where(eq(httpCache.key, key)).get();
  if (!row || row.expiresAt.getTime() <= now.getTime()) return undefined;
  return row.body;
}

export function writeHttpCache(
  db: AppDatabase,
  key: string,
  body: unknown,
  ttlMs: number,
  now: Date,
): void {
  const expiresAt = new Date(now.getTime() + ttlMs);
  db.insert(httpCache)
    .values({ key, body, fetchedAt: now, expiresAt })
    .onConflictDoUpdate({ target: httpCache.key, set: { body, fetchedAt: now, expiresAt } })
    .run();
}

/** Read-through cache: returns the stored body or calls `load` and stores its (non-null) result. */
export async function cachedJson<T>(
  deps: HttpDeps,
  key: string,
  ttlMs: number,
  load: () => Promise<T>,
): Promise<T> {
  const now = deps.now?.() ?? new Date();
  const hit = readHttpCache(deps.db, key, now);
  if (hit !== undefined) return hit as T;
  const body = await load();
  writeHttpCache(deps.db, key, body, ttlMs, now);
  return body;
}

/** Deletes expired entries; returns the number of rows removed. */
export function purgeExpiredHttpCache(db: AppDatabase, now = new Date()): number {
  return db.delete(httpCache).where(lte(httpCache.expiresAt, now)).run().changes;
}
