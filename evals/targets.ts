import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { UIMessageChunk } from "ai";
import { desc, eq, sql } from "drizzle-orm";
import { paceMinutes, scheduleItineraryDay } from "../src/lib/itinerary";
import { streamChatTurn, type ChatDeps } from "../src/server/agent/agent";
import { createCheckpointer } from "../src/server/agent/checkpointer";
import { detectPromptAttack, type GuardrailHit } from "../src/server/agent/guardrails";
import type { LlmBudget } from "../src/server/ai/budget";
import { SqliteLlmCache } from "../src/server/ai/cache";
import { openDatabase, runMigrations, type AppDatabase } from "../src/server/db/connection";
import { cities, itineraries, places, swipes } from "../src/server/db/schema";
import type { Env } from "../src/server/env-schema";
import { generateItinerary } from "../src/server/itinerary/itineraries";
import { createTrip, getTrip, recordSwipe } from "../src/server/trips/trips";
import type { AdversarialCase, TripCase } from "./datasets";

/**
 * What the evals run: the real workflows on a throwaway copy of the app database (seeded
 * cities included), so eval trips never show up in the app. Provider requests still count
 * against the app's daily LLM budget.
 */

export type EvalContext = {
  db: AppDatabase;
  deps: ChatDeps;
  cleanup: () => void;
};

export async function createEvalContext(
  appSqlite: ReturnType<typeof openDatabase>["sqlite"],
  env: Env,
  budget: LlmBudget,
): Promise<EvalContext> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "travel-swipe-evals-"));
  const file = path.join(dir, "evals.db");
  await appSqlite.backup(file);
  const { db, sqlite } = openDatabase(file);
  runMigrations(db);
  // The LLM cache is shared with the app for discovery, but planning answers are not cached:
  // an eval must measure the model, not a stored answer.
  const deps: ChatDeps = {
    db,
    env,
    budget,
    checkpointer: createCheckpointer(sqlite),
    discovery: { db, env, budget, llmCache: new SqliteLlmCache(db) },
    planner: { env, budget },
  };
  return {
    db,
    deps,
    cleanup: () => {
      sqlite.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

function findCity(db: AppDatabase, name: string) {
  return db
    .select()
    .from(cities)
    .where(sql`lower(${cities.name}) = lower(${name})`)
    .get();
}

/** The city's most popular places, best first (empty when the city was never seeded). */
export function topPlaces(db: AppDatabase, cityName: string, count: number) {
  const city = findCity(db, cityName);
  if (!city) return [];
  return db
    .select()
    .from(places)
    .where(eq(places.cityId, city.id))
    .orderBy(desc(places.popularity))
    .limit(count)
    .all();
}

export type TripOutputs = {
  source: "ai" | "fallback";
  /** Planner model calls (1 = right the first time). */
  attempts: number;
  mustSeeMissing: string[];
  overBudgetDays: number;
  planned: number;
  excluded: number;
};

/** Workflow B on a fresh trip: the top places shortlisted, the first ones as must-sees. */
export async function planTripCase(ctx: EvalContext, input: TripCase): Promise<TripOutputs> {
  const pool = topPlaces(ctx.db, input.city, input.places);
  if (pool.length === 0) throw new Error(`${input.city} is not seeded (npm run db:seed)`);
  const trip = createTrip(ctx.db, {
    cityId: pool[0].cityId,
    days: input.days,
    pace: input.pace,
    interests: [],
  });
  pool.forEach((p, i) => recordSwipe(ctx.db, trip, p.id, i < input.mustSee ? "must" : "like"));
  const result = await generateItinerary(ctx.db, getTrip(ctx.db, trip.id)!, ctx.deps.planner);

  const planned = new Set(result.data.days.flatMap((d) => d.stops.map((s) => s.placeId)));
  const byId = new Map(pool.map((p) => [p.id, p]));
  const budget = paceMinutes(input.pace);
  return {
    source: result.data.source,
    attempts: result.attempts,
    mustSeeMissing: pool
      .slice(0, input.mustSee)
      .filter((p) => !planned.has(p.id))
      .map((p) => p.name),
    overBudgetDays: result.data.days.filter(
      (d) => scheduleItineraryDay(d, byId, budget).overMinutes > 0,
    ).length,
    planned: planned.size,
    excluded: result.data.excluded.length,
  };
}

export type ChatOutputs = {
  reply: string;
  guardrail: GuardrailHit | null;
  tools: string[];
  ownTripChanged: boolean;
  otherTripChanged: boolean;
  error: string | null;
};

/** Everything a turn could change about a trip. */
function tripState(db: AppDatabase, tripId: string): string {
  return JSON.stringify({
    trip: getTrip(db, tripId)?.trip,
    swipes: db.select().from(swipes).where(eq(swipes.tripId, tripId)).all(),
    versions: db.select().from(itineraries).where(eq(itineraries.tripId, tripId)).all().length,
  });
}

/** One chat turn on a fresh trip, next to another trip the turn must not touch. */
export async function chatCase(
  ctx: EvalContext,
  input: AdversarialCase,
  cityName: string,
): Promise<ChatOutputs> {
  const pool = topPlaces(ctx.db, cityName, 3);
  if (pool.length === 0) throw new Error(`${cityName} is not seeded (npm run db:seed)`);
  const [own, other] = [0, 1].map(() => {
    const trip = createTrip(ctx.db, {
      cityId: pool[0].cityId,
      days: 2,
      pace: "balanced",
      interests: [],
    });
    pool.forEach((p) => recordSwipe(ctx.db, trip, p.id, "like"));
    return trip;
  });
  const before = { own: tripState(ctx.db, own.id), other: tripState(ctx.db, other.id) };
  const text = input.text.replaceAll("{otherTripId}", other.id);

  const chunks: UIMessageChunk[] = [];
  const reader = (await streamChatTurn(ctx.deps, { tripId: own.id, text })).getReader();
  for (let r = await reader.read(); !r.done; r = await reader.read()) chunks.push(r.value);

  return {
    reply: chunks.flatMap((c) => (c.type === "text-delta" ? [c.delta] : [])).join(""),
    guardrail: detectPromptAttack(text),
    tools: chunks.flatMap((c) => (c.type === "tool-input-available" ? [c.toolName] : [])),
    ownTripChanged: tripState(ctx.db, own.id) !== before.own,
    otherTripChanged: tripState(ctx.db, other.id) !== before.other,
    error: chunks.flatMap((c) => (c.type === "error" ? [c.errorText] : []))[0] ?? null,
  };
}
