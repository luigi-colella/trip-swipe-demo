/** Trip vocabulary shared by the database schema, server actions and the UI. */
export const PACES = ["relaxed", "balanced", "intense"] as const;
export type Pace = (typeof PACES)[number];

/** Active sightseeing hours per day for each pace (F1). */
export const PACE_HOURS: Record<Pace, number> = { relaxed: 6, balanced: 8, intense: 10 };

export const PACE_LABELS: Record<Pace, string> = {
  relaxed: "Relaxed",
  balanced: "Balanced",
  intense: "Intense",
};

export const SWIPE_DECISIONS = ["like", "skip", "must"] as const;
export type SwipeDecision = (typeof SWIPE_DECISIONS)[number];

/** Furthest step the trip has reached: Setup → Swipe → Review → Itinerary. */
export const TRIP_STATUSES = ["swiping", "review", "itinerary"] as const;
export type TripStatus = (typeof TRIP_STATUSES)[number];

export const MIN_DAYS = 1;
export const MAX_DAYS = 7;

/** Trip IDs are UUIDs (checked without Zod: this module is part of client bundles). */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isTripId(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}
