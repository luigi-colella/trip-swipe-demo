import { z } from "zod";
import { INTEREST_TAGS } from "./places";
import { MAX_DAYS, MIN_DAYS, PACES } from "./trip";

/**
 * Zod schemas of the trip (server-side validation), kept apart from `trip.ts` so that client
 * components using the trip vocabulary do not ship Zod in their initial bundle.
 */

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
