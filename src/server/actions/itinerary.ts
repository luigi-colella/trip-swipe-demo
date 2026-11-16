"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { ItineraryEditSchema, type ItinerarySource } from "@/lib/itinerary";
import { TripIdSchema } from "@/lib/trip";
import { db } from "@/server/db/client";
import { plannerDeps } from "@/server/itinerary/deps";
import {
  EmptyShortlistError,
  editItinerary,
  generateItinerary,
  undoItinerary,
} from "@/server/itinerary/itineraries";
import { getTrip } from "@/server/trips/trips";
import type { ActionResult } from "./trips";

/**
 * Server Actions for the itinerary step (F4). Planning never fails because of the model:
 * workflow B falls back to the deterministic plan, so errors here are input or database ones.
 */

const fail = (error: string) => ({ ok: false as const, error });

function findTrip(tripId: string) {
  const id = TripIdSchema.safeParse(tripId);
  return id.success ? getTrip(db, id.data) : undefined;
}

/** Review → Itinerary: plans the shortlist and opens the itinerary. */
export async function generateItineraryAction(tripId: string): Promise<ActionResult> {
  const found = findTrip(tripId);
  if (!found) return fail("Trip not found.");
  try {
    await generateItinerary(db, found, plannerDeps);
  } catch (err) {
    if (err instanceof EmptyShortlistError) return fail(err.message);
    console.error("generateItinerary failed", err);
    return fail("Could not plan the trip right now, please retry.");
  }
  redirect(`/trip/${found.trip.id}/itinerary`);
}

/** F4 "regenerate": asks for an alternative plan, saved as a new (undoable) version. */
export async function regenerateItineraryAction(
  tripId: string,
): Promise<ActionResult<{ source: ItinerarySource }>> {
  const found = findTrip(tripId);
  if (!found) return fail("Trip not found.");
  try {
    const result = await generateItinerary(db, found, plannerDeps, { regenerate: true });
    refresh();
    return { ok: true, data: { source: result.data.source } };
  } catch (err) {
    if (err instanceof EmptyShortlistError) return fail(err.message);
    console.error("regenerateItinerary failed", err);
    return fail("Could not plan the trip right now, please retry.");
  }
}

/** F4 quick actions: remove, move within the day, change day. */
export async function editItineraryAction(tripId: string, edit: unknown): Promise<ActionResult> {
  const found = findTrip(tripId);
  if (!found) return fail("Trip not found.");
  const parsed = ItineraryEditSchema.safeParse(edit);
  if (!parsed.success) return fail("Invalid change.");
  if (!editItinerary(db, found.trip.id, parsed.data)) return fail("This change no longer applies.");
  refresh();
  return { ok: true };
}

/** F4 undo: back to the previous version. */
export async function undoItineraryAction(tripId: string): Promise<ActionResult> {
  const found = findTrip(tripId);
  if (!found) return fail("Trip not found.");
  if (!undoItinerary(db, found.trip.id)) return fail("Nothing to undo.");
  refresh();
  return { ok: true };
}
