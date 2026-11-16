import { z } from "zod";
import { ITINERARY_SOURCES } from "./itinerary";
import { MAX_DAYS } from "./trip";

/**
 * Zod schemas of the itinerary model (F4), kept apart from `itinerary.ts` so that client
 * components using the schedule helpers do not ship Zod in their initial bundle.
 */

const StopSchema = z.object({
  placeId: z.string(),
  /** Short practical tip from the planner; null for deterministic plans. */
  tip: z.string().nullable(),
});

export const ItineraryDataSchema = z.object({
  days: z.array(z.object({ title: z.string(), stops: z.array(StopSchema) })),
  excluded: z.array(z.object({ placeId: z.string(), reason: z.string() })),
  /** "ai" when the LLM plan passed validation, "fallback" when code planned it alone. */
  source: z.enum(ITINERARY_SOURCES),
});
export type ItineraryData = z.infer<typeof ItineraryDataSchema>;

/** Deterministic edits (F4 quick actions; also the agent's edit_itinerary ops). */
export const ItineraryEditSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("remove"), placeId: z.uuid() }),
  z.object({ type: z.literal("move"), placeId: z.uuid(), direction: z.enum(["up", "down"]) }),
  z.object({
    type: z.literal("change-day"),
    placeId: z.uuid(),
    /** Zero-based day index. */
    day: z
      .number()
      .int()
      .min(0)
      .max(MAX_DAYS - 1),
  }),
]);
export type ItineraryEdit = z.infer<typeof ItineraryEditSchema>;
