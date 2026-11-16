import { z } from "zod";
import { INTEREST_TAGS } from "./places";

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

export const TripIdSchema = z.uuid();

/**
 * Trip setup form (F1). The city is identified by the autocomplete query plus the OSM
 * reference of the chosen suggestion: the server resolves it again from its own (cached)
 * Photon results instead of trusting names or coordinates sent by the client.
 */
export const TripSetupSchema = z.object({
  cityQuery: z.string().trim().min(2).max(80),
  osmRef: z.string().regex(/^[NWR]\d{1,15}$/, "Pick a city from the suggestions."),
  days: z.coerce.number().int().min(MIN_DAYS).max(MAX_DAYS),
  pace: z.enum(PACES),
  interests: z.array(z.enum(INTEREST_TAGS as [string, ...string[]])).max(INTEREST_TAGS.length),
});
export type TripSetup = z.infer<typeof TripSetupSchema>;
