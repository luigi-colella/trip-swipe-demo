import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { DeckEntry } from "@/lib/deck";
import { safeHttpUrl, type PlaceCard } from "@/lib/places";
import { computeTagWeights, rankPlaces } from "@/lib/ranking";
import type { Pace, SwipeDecision, TripStatus } from "@/lib/trip";
import type { AppDatabase } from "@/server/db/connection";
import { cities, places, swipes, trips } from "@/server/db/schema";
import type { City } from "@/server/places/cities";
import type { Place } from "@/server/places/discover";
import { defined } from "@/lib/invariant";

/**
 * Trip state (F1, F3, F8, F10). Plain functions over an injected database so that server
 * actions stay thin and integration tests can use a temporary SQLite file.
 */

export type Trip = typeof trips.$inferSelect;
export type TripWithCity = { trip: Trip; city: City };
export type SwipeEntry = DeckEntry;

/** Client-safe view of a place; third-party URLs are restricted to http(s). */
export function toPlaceCard(p: Place): PlaceCard {
  return {
    id: p.id,
    name: p.name,
    category: p.category,
    tags: p.tags,
    pitch: p.pitch,
    visitMinutes: p.visitMinutes,
    popularity: p.popularity,
    wikiUrl: safeHttpUrl(p.wikiUrl) ?? "https://en.wikipedia.org/",
    imageUrl: safeHttpUrl(p.imageUrl),
    imageAuthor: p.imageAuthor,
    imageLicense: p.imageLicense,
    imageLicenseUrl: safeHttpUrl(p.imageLicenseUrl),
    imagePageUrl: safeHttpUrl(p.imagePageUrl),
  };
}

export function createTrip(
  db: AppDatabase,
  input: { cityId: string; days: number; pace: Pace; interests: readonly string[] },
): Trip {
  return db
    .insert(trips)
    .values({ id: crypto.randomUUID(), ...input, interests: [...input.interests] })
    .returning()
    .get();
}

export function getTrip(db: AppDatabase, tripId: string): TripWithCity | undefined {
  const row = db
    .select({ trip: trips, city: cities })
    .from(trips)
    .innerJoin(cities, eq(trips.cityId, cities.id))
    .where(eq(trips.id, tripId))
    .get();
  return row ?? undefined;
}

export type TripSettings = { days?: number; pace?: Pace; interests?: readonly string[] };

/** Changes days, pace or interests (agent `set_trip`); the caller re-plans if needed. */
export function updateTripSettings(db: AppDatabase, tripId: string, settings: TripSettings): void {
  const { interests, ...rest } = settings;
  db.update(trips)
    .set({ ...rest, ...(interests && { interests: [...interests] }), updatedAt: new Date() })
    .where(eq(trips.id, tripId))
    .run();
}

export function setTripStatus(db: AppDatabase, tripId: string, status: TripStatus): void {
  db.update(trips).set({ status, updatedAt: new Date() }).where(eq(trips.id, tripId)).run();
}

/**
 * Swipes in the order they were made. `rowid` is SQLite's insertion order: created_at has
 * one-second resolution, too coarse for quick swipes, and the undo stack depends on it.
 */
export function getSwipeHistory(db: AppDatabase, tripId: string): SwipeEntry[] {
  return db
    .select({ place: places, decision: swipes.decision })
    .from(swipes)
    .innerJoin(places, eq(swipes.placeId, places.id))
    .where(eq(swipes.tripId, tripId))
    .orderBy(asc(sql`${swipes}.rowid`))
    .all()
    .map((r) => ({ place: toPlaceCard(r.place), decision: r.decision }));
}

/**
 * Records (or changes) a decision. The place must belong to the trip's city: IDs coming from
 * the client are never trusted on their own. Returns false when the place is not eligible.
 */
export function recordSwipe(
  db: AppDatabase,
  trip: Pick<Trip, "id" | "cityId">,
  placeId: string,
  decision: SwipeDecision,
): boolean {
  const place = db
    .select({ id: places.id })
    .from(places)
    .where(and(eq(places.id, placeId), eq(places.cityId, trip.cityId)))
    .get();
  if (!place) return false;
  db.insert(swipes)
    .values({ tripId: trip.id, placeId, decision })
    .onConflictDoUpdate({ target: [swipes.tripId, swipes.placeId], set: { decision } })
    .run();
  db.update(trips).set({ updatedAt: new Date() }).where(eq(trips.id, trip.id)).run();
  return true;
}

/** Undo: forgets the decision, so the place goes back into the deck. */
export function removeSwipe(db: AppDatabase, tripId: string, placeId: string): boolean {
  const { changes } = db
    .delete(swipes)
    .where(and(eq(swipes.tripId, tripId), eq(swipes.placeId, placeId)))
    .run();
  return changes > 0;
}

export function countShortlist(db: AppDatabase, tripId: string): number {
  return defined(
    db
      .select({ n: sql<number>`count(*)` })
      .from(swipes)
      .where(and(eq(swipes.tripId, tripId), inArray(swipes.decision, ["like", "must"])))
      .get(),
    "the shortlist count",
  ).n;
}

/** Liked and must-see places (F10): must-see first, then in swipe order. */
export function getShortlist(db: AppDatabase, tripId: string): SwipeEntry[] {
  const kept = getSwipeHistory(db, tripId).filter((s) => s.decision !== "skip");
  return [
    ...kept.filter((s) => s.decision === "must"),
    ...kept.filter((s) => s.decision === "like"),
  ];
}

export type InitialDeck = {
  /** Places not swiped yet, best first. */
  deck: PlaceCard[];
  /** Swipes in order (the undo stack). */
  history: SwipeEntry[];
};

/** F8: the unswiped part of the pool, ranked by interests plus swipe-learned weights. */
export function buildDeck(
  pool: readonly Place[],
  history: readonly SwipeEntry[],
  interests: readonly string[],
): InitialDeck {
  const swiped = new Set(history.map((s) => s.place.id));
  const deck = rankPlaces(pool.filter((p) => !swiped.has(p.id)).map(toPlaceCard), {
    interests,
    weights: computeTagWeights(history),
  });
  return { deck, history: [...history] };
}
