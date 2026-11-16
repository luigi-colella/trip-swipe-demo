import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  applyItineraryEdit,
  ItineraryDataSchema,
  type ItineraryData,
  type ItineraryEdit,
  type ItineraryPlace,
} from "@/lib/itinerary";
import type { AppDatabase } from "@/server/db/connection";
import { itineraries, places, swipes, trips } from "@/server/db/schema";
import { toPlaceCard, type TripWithCity } from "@/server/trips/trips";
import type { PlannerPlace } from "./fallback";
import { planItinerary, type PlannerDeps, type PlannerResult } from "./graph";

/**
 * Itinerary versions (F4). Every change — generation, regeneration, quick action — is saved
 * as a new version; undo steps back by deleting the newest one (no redo).
 */

export type ItineraryVersion = { version: number; data: ItineraryData; versions: number };

export function getLatestItinerary(db: AppDatabase, tripId: string): ItineraryVersion | undefined {
  const row = db
    .select({ version: itineraries.version, data: itineraries.data })
    .from(itineraries)
    .where(eq(itineraries.tripId, tripId))
    .orderBy(desc(itineraries.version))
    .limit(1)
    .get();
  if (!row) return undefined;
  const versions = db
    .select({ n: sql<number>`count(*)` })
    .from(itineraries)
    .where(eq(itineraries.tripId, tripId))
    .get()!.n;
  return { version: row.version, data: ItineraryDataSchema.parse(row.data), versions };
}

export function saveItinerary(db: AppDatabase, tripId: string, data: ItineraryData): number {
  return db.transaction((tx) => {
    const { max } = tx
      .select({ max: sql<number>`coalesce(max(${itineraries.version}), 0)` })
      .from(itineraries)
      .where(eq(itineraries.tripId, tripId))
      .get()!;
    const version = max + 1;
    tx.insert(itineraries).values({ id: crypto.randomUUID(), tripId, version, data }).run();
    tx.update(trips).set({ updatedAt: new Date() }).where(eq(trips.id, tripId)).run();
    return version;
  });
}

/** Deletes the newest version when an older one exists. Returns false if there is none. */
export function undoItinerary(db: AppDatabase, tripId: string): boolean {
  const latest = getLatestItinerary(db, tripId);
  if (!latest || latest.versions < 2) return false;
  db.delete(itineraries)
    .where(and(eq(itineraries.tripId, tripId), eq(itineraries.version, latest.version)))
    .run();
  return true;
}

/** Liked and must-see places with what the planner needs (coordinates, visit time). */
export function getPlanningShortlist(db: AppDatabase, tripId: string): PlannerPlace[] {
  return db
    .select({ place: places, decision: swipes.decision })
    .from(swipes)
    .innerJoin(places, eq(swipes.placeId, places.id))
    .where(and(eq(swipes.tripId, tripId), inArray(swipes.decision, ["like", "must"])))
    .orderBy(places.name)
    .all()
    .map(({ place, decision }) => ({
      id: place.id,
      name: place.name,
      category: place.category,
      lat: place.lat,
      lon: place.lon,
      visitMinutes: place.visitMinutes,
      popularity: place.popularity,
      must: decision === "must",
    }));
}

/** Places referenced by an itinerary, restricted to the trip's city, with must-see flags. */
export function getItineraryPlaces(
  db: AppDatabase,
  found: TripWithCity,
  data: ItineraryData,
): ItineraryPlace[] {
  const ids = [
    ...data.days.flatMap((d) => d.stops.map((s) => s.placeId)),
    ...data.excluded.map((x) => x.placeId),
  ];
  if (ids.length === 0) return [];
  return db
    .select({ place: places, decision: swipes.decision })
    .from(places)
    .leftJoin(swipes, and(eq(swipes.placeId, places.id), eq(swipes.tripId, found.trip.id)))
    .where(and(eq(places.cityId, found.city.id), inArray(places.id, ids)))
    .all()
    .map(({ place, decision }) => ({
      ...toPlaceCard(place),
      lat: place.lat,
      lon: place.lon,
      must: decision === "must",
    }));
}

export class EmptyShortlistError extends Error {
  constructor() {
    super("Like at least one place first.");
    this.name = "EmptyShortlistError";
  }
}

/** Concurrent requests for the same trip share one planning run (and its LLM calls). */
const inFlight = new Map<string, Promise<PlannerResult & { version: number }>>();

/**
 * Plans the trip's shortlist (workflow B), saves it as a new version and moves the trip to
 * the itinerary step. `regenerate` asks for an alternative to the current plan;
 * `instructions` are the traveller's wishes relayed by the chat agent.
 */
export function generateItinerary(
  db: AppDatabase,
  found: TripWithCity,
  deps: PlannerDeps,
  { regenerate = false, instructions }: { regenerate?: boolean; instructions?: string } = {},
): Promise<PlannerResult & { version: number }> {
  const { trip, city } = found;
  const pending = inFlight.get(trip.id);
  if (pending) return pending;
  const run = (async () => {
    const shortlist = getPlanningShortlist(db, trip.id);
    if (shortlist.length === 0) throw new EmptyShortlistError();
    const previous = regenerate ? getLatestItinerary(db, trip.id)?.data : undefined;
    const result = await planItinerary(
      { city, days: trip.days, pace: trip.pace, places: shortlist, previous, instructions },
      deps,
    );
    const version = saveItinerary(db, trip.id, result.data);
    db.update(trips).set({ status: "itinerary" }).where(eq(trips.id, trip.id)).run();
    return { ...result, version };
  })().finally(() => inFlight.delete(trip.id));
  inFlight.set(trip.id, run);
  return run;
}

/** Applies a quick action to the latest version. Returns false when it does not apply. */
export function editItinerary(db: AppDatabase, tripId: string, edit: ItineraryEdit): boolean {
  const latest = getLatestItinerary(db, tripId);
  if (!latest) return false;
  const next = applyItineraryEdit(latest.data, edit);
  if (!next) return false;
  saveItinerary(db, tripId, next);
  return true;
}
