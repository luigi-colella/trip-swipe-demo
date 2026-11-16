"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { PlaceCard } from "@/lib/places";
import { SWIPE_DECISIONS } from "@/lib/trip";
import { TripIdSchema, TripSetupSchema } from "@/lib/trip-schemas";
import { aiBusyText, isAiBusyError } from "@/server/ai/budget";
import { llmBudget } from "@/server/ai/runtime";
import { db } from "@/server/db/client";
import { limitAiAction } from "@/server/limits/request";
import { upsertCity } from "@/server/places/cities";
import { loadMorePlaces } from "@/server/places/discover";
import { discoveryDeps } from "@/server/places/deps";
import { searchCities } from "@/server/places/photon";
import {
  countShortlist,
  createTrip,
  getTrip,
  recordSwipe,
  removeSwipe,
  setTripStatus,
  toPlaceCard,
} from "@/server/trips/trips";

/**
 * Server Actions for Setup → Swipe → Review. Every input is validated; the trip is addressed
 * by its unguessable UUID and every place ID is checked against the trip's city.
 */

export type ActionResult<T = undefined> =
  ({ ok: true } & (T extends undefined ? unknown : { data: T })) | { ok: false; error: string };

const fail = (error: string) => ({ ok: false as const, error });
const PlaceIdSchema = z.uuid();

export type CreateTripState = { error?: string } | undefined;

/** F1: creates the trip from the setup form and opens its deck. */
export async function createTripAction(
  _prev: CreateTripState,
  formData: FormData,
): Promise<CreateTripState> {
  const parsed = TripSetupSchema.safeParse({
    cityQuery: formData.get("cityQuery"),
    osmRef: formData.get("osmRef"),
    days: formData.get("days"),
    pace: formData.get("pace"),
    interests: formData.getAll("interests"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }
  const input = parsed.data;
  // A new trip may start place discovery (an LLM call) for a city nobody has visited yet.
  const limited = await limitAiAction();
  if (limited) return { error: limited };

  let tripId: string;
  try {
    // Served from the autocomplete cache: the user picked this suggestion moments ago.
    const suggestion = (await searchCities(input.cityQuery, { db })).find(
      (c) => c.osmRef === input.osmRef,
    );
    if (!suggestion) return { error: "Pick a city from the suggestions." };
    const city = upsertCity(db, suggestion);
    tripId = createTrip(db, {
      cityId: city.id,
      days: input.days,
      pace: input.pace,
      interests: input.interests,
    }).id;
  } catch (err) {
    console.error("createTrip failed", err);
    return { error: "City search is unavailable, please retry." };
  }
  redirect(`/trip/${tripId}/swipe`);
}

const SwipeInput = z.object({
  tripId: TripIdSchema,
  placeId: PlaceIdSchema,
  decision: z.enum(SWIPE_DECISIONS),
});

/** F3: persists one swipe. The deck lives on the client, so nothing is re-rendered. */
export async function recordSwipeAction(
  tripId: string,
  placeId: string,
  decision: string,
): Promise<ActionResult> {
  const input = SwipeInput.safeParse({ tripId, placeId, decision });
  if (!input.success) return fail("Invalid swipe.");
  const found = getTrip(db, input.data.tripId);
  if (!found) return fail("Trip not found.");
  if (!recordSwipe(db, found.trip, input.data.placeId, input.data.decision)) {
    return fail("This place is not part of the trip.");
  }
  return { ok: true };
}

/** F3 undo: forgets one decision so the place returns to the deck. */
export async function undoSwipeAction(tripId: string, placeId: string): Promise<ActionResult> {
  const input = SwipeInput.omit({ decision: true }).safeParse({ tripId, placeId });
  if (!input.success) return fail("Invalid undo.");
  if (!getTrip(db, input.data.tripId)) return fail("Trip not found.");
  removeSwipe(db, input.data.tripId, input.data.placeId);
  return { ok: true };
}

/** F3 "Load more": one discovery round (an LLM call in live mode) that grows the city pool. */
export async function loadMorePlacesAction(tripId: string): Promise<ActionResult<PlaceCard[]>> {
  const id = TripIdSchema.safeParse(tripId);
  if (!id.success) return fail("Invalid trip.");
  const found = getTrip(db, id.data);
  if (!found) return fail("Trip not found.");
  const limited = await limitAiAction();
  if (limited) return fail(limited);
  try {
    const report = await loadMorePlaces(found.city, discoveryDeps);
    return { ok: true, data: report.added.map(toPlaceCard) };
  } catch (err) {
    if (isAiBusyError(err)) return fail(aiBusyText(llmBudget));
    console.error("loadMorePlaces failed", err);
    return fail("Could not find more places right now, please retry.");
  }
}

/** Swipe → Review (F10): allowed as soon as one place is liked or marked must-see. */
export async function startReviewAction(tripId: string): Promise<ActionResult> {
  const id = TripIdSchema.safeParse(tripId);
  if (!id.success) return fail("Invalid trip.");
  const found = getTrip(db, id.data);
  if (!found) return fail("Trip not found.");
  if (countShortlist(db, found.trip.id) === 0) return fail("Like at least one place first.");
  if (found.trip.status === "swiping") setTripStatus(db, found.trip.id, "review");
  redirect(`/trip/${found.trip.id}/review`);
}

/** F10: promote to must-see, demote to like, or remove (recorded as a skip). */
export async function updateShortlistAction(
  tripId: string,
  placeId: string,
  decision: string,
): Promise<ActionResult> {
  const result = await recordSwipeAction(tripId, placeId, decision);
  if (result.ok) refresh();
  return result;
}
