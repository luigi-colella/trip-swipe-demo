import type { TripUpdate } from "@/lib/chat";
import {
  applyItineraryEdit,
  paceMinutes,
  type ItineraryData,
  type ItineraryEdit,
} from "@/lib/itinerary";
import { INTEREST_TAGS, normalizeTags } from "@/lib/places";
import { PACE_LABELS, type Pace } from "@/lib/trip";
import type { AppDatabase } from "@/server/db/connection";
import type { PlannerDeps } from "@/server/itinerary/graph";
import { didNotFitReason } from "@/server/itinerary/fallback";
import { insertIntoItinerary } from "@/server/itinerary/insert";
import {
  generateItinerary,
  getItineraryPlaces,
  getLatestItinerary,
  saveItinerary,
} from "@/server/itinerary/itineraries";
import { upsertCity } from "@/server/places/cities";
import { getCityPool, loadMorePlaces, type DiscoveryDeps } from "@/server/places/discover";
import { searchCities } from "@/server/places/photon";
import {
  countShortlist,
  createTrip,
  getShortlist,
  getTrip,
  recordSwipe,
  updateTripSettings,
  type TripWithCity,
} from "@/server/trips/trips";
import { describeMiss, matchByName } from "./match";

/**
 * What the agent's tools do (§3.3 C), as plain functions: every input is a name or a setting,
 * resolved against the trip bound to the chat on the server. Each returns a short reply for
 * the model and, when the trip changed, the update the client applies to the visual area.
 */

export type AgentDeps = {
  db: AppDatabase;
  discovery: DiscoveryDeps;
  planner: PlannerDeps;
};

/** The trip this chat acts on. `set_trip` may bind a new one during a turn. */
export type AgentSession = { tripId: string | null; createdTripId?: string };

export type ToolOutcome = { reply: string; update?: TripUpdate };

export const DEFAULT_DAYS = 3;
export const DEFAULT_PACE: Pace = "balanced";
export const NO_TRIP_REPLY =
  "There is no trip yet: ask for the city (and the number of days), then call set_trip.";

function currentTrip(deps: AgentDeps, session: AgentSession): TripWithCity | undefined {
  return session.tripId ? getTrip(deps.db, session.tripId) : undefined;
}

const daysLabel = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;

/** Interests the model names, kept only when they belong to the app's vocabulary. */
export function normalizeInterests(values: readonly string[]): string[] {
  const allowed = new Set<string>(INTEREST_TAGS);
  return normalizeTags(values).filter((t) => allowed.has(t));
}

export type SetTripInput = {
  city?: string;
  days?: number;
  pace?: Pace;
  interests?: string[];
};

/** Creates the trip (home page, or another city) or changes days, pace and interests. */
export async function setTrip(
  deps: AgentDeps,
  session: AgentSession,
  input: SetTripInput,
): Promise<ToolOutcome> {
  const found = currentTrip(deps, session);
  const interests = input.interests && normalizeInterests(input.interests);

  let cityId = found?.city.id;
  let cityLabel = found ? `${found.city.name}, ${found.city.country}` : "";
  if (input.city) {
    const [suggestion] = await searchCities(input.city, { db: deps.db });
    if (!suggestion) return { reply: `No city called "${input.city}" was found.` };
    const city = upsertCity(deps.db, suggestion);
    cityId = city.id;
    cityLabel = `${city.name}, ${city.country}`;
  }
  if (!cityId) return { reply: "Which city? A trip needs a city first." };

  if (!found || cityId !== found.city.id) {
    const days = input.days ?? found?.trip.days ?? DEFAULT_DAYS;
    const pace = input.pace ?? found?.trip.pace ?? DEFAULT_PACE;
    const trip = createTrip(deps.db, {
      cityId,
      days,
      pace,
      interests: interests ?? found?.trip.interests ?? [],
    });
    session.tripId = trip.id;
    session.createdTripId = trip.id;
    return {
      reply: `Created a trip to ${cityLabel}: ${daysLabel(days)}, ${PACE_LABELS[pace].toLowerCase()} pace. The user can now swipe through its attractions.`,
      update: { tripId: trip.id, view: "swipe" },
    };
  }

  const { trip } = found;
  updateTripSettings(deps.db, trip.id, { days: input.days, pace: input.pace, interests });
  const updated = getTrip(deps.db, trip.id)!;
  const summary = `${daysLabel(updated.trip.days)}, ${PACE_LABELS[updated.trip.pace].toLowerCase()} pace`;
  const replan =
    (updated.trip.days !== trip.days || updated.trip.pace !== trip.pace) &&
    getLatestItinerary(deps.db, trip.id) !== undefined;
  if (!replan) {
    return { reply: `Trip updated: ${summary}.`, update: { tripId: trip.id } };
  }
  await generateItinerary(deps.db, updated, deps.planner);
  return {
    reply: `Trip updated: ${summary}. The itinerary was planned again to match.`,
    update: { tripId: trip.id, view: "itinerary" },
  };
}

/** "Load more": one discovery round for the trip's city. */
export async function findMorePlaces(deps: AgentDeps, session: AgentSession): Promise<ToolOutcome> {
  const found = currentTrip(deps, session);
  if (!found) return { reply: NO_TRIP_REPLY };
  const report = await loadMorePlaces(found.city, deps.discovery);
  if (report.added.length === 0) return { reply: "No new places were found for this city." };
  const names = report.added.map((p) => p.name);
  return {
    reply: `Added ${names.length} places to the swipe deck: ${names.join(", ")}.`,
    update: { tripId: found.trip.id, view: "swipe" },
  };
}

/** Adds a place of the city pool to the shortlist and, when there is one, to the itinerary. */
export function addPlace(
  deps: AgentDeps,
  session: AgentSession,
  input: { name: string; mustSee?: boolean },
): ToolOutcome {
  const found = currentTrip(deps, session);
  if (!found) return { reply: NO_TRIP_REPLY };
  const { trip, city } = found;
  const match = matchByName(getCityPool(deps.db, city.id), input.name);
  if (match.kind !== "found") {
    const miss = describeMiss(match, input.name, `among the ${city.name} places`);
    return { reply: match.kind === "none" ? `${miss} Try find_more_places.` : miss };
  }
  const place = match.item;
  recordSwipe(deps.db, trip, place.id, input.mustSee ? "must" : "like");
  const label = input.mustSee ? "as a must-see" : "to the shortlist";

  const latest = getLatestItinerary(deps.db, trip.id);
  if (!latest) {
    return { reply: `Added ${place.name} ${label}.`, update: { tripId: trip.id } };
  }
  const known = new Map(getItineraryPlaces(deps.db, found, latest.data).map((p) => [p.id, p]));
  const result = insertIntoItinerary(
    latest.data,
    { ...place, must: Boolean(input.mustSee) },
    known,
    paceMinutes(trip.pace),
    didNotFitReason(trip.days, trip.pace),
  );
  const update: TripUpdate = { tripId: trip.id, view: "itinerary" };
  switch (result.kind) {
    case "already-planned":
      return { reply: `${place.name} is already planned on Day ${result.day + 1}.`, update };
    case "excluded":
      saveItinerary(deps.db, trip.id, result.data);
      return {
        reply: `Added ${place.name} ${label}, but it does not fit in any day, so it is listed as excluded.`,
        update,
      };
    case "added":
      saveItinerary(deps.db, trip.id, result.data);
      return { reply: `Added ${place.name} to Day ${result.day + 1}.`, update };
  }
}

/** Removes a place from the itinerary, or from the shortlist before planning. */
export function removePlace(
  deps: AgentDeps,
  session: AgentSession,
  input: { name: string },
): ToolOutcome {
  const found = currentTrip(deps, session);
  if (!found) return { reply: NO_TRIP_REPLY };
  const { trip } = found;

  const latest = getLatestItinerary(deps.db, trip.id);
  if (latest) {
    const planned = plannedPlaces(deps, found, latest.data);
    const match = matchByName(planned, input.name);
    if (match.kind === "found") {
      const next = applyItineraryEdit(latest.data, { type: "remove", placeId: match.item.id })!;
      saveItinerary(deps.db, trip.id, next);
      return {
        reply: `Removed ${match.item.name} from the itinerary.`,
        update: { tripId: trip.id, view: "itinerary" },
      };
    }
    if (match.kind === "ambiguous") return { reply: describeMiss(match, input.name, "planned") };
  }

  const shortlist = getShortlist(deps.db, trip.id).map((e) => e.place);
  const match = matchByName(shortlist, input.name);
  if (match.kind !== "found") {
    return { reply: describeMiss(match, input.name, "in the trip") };
  }
  recordSwipe(deps.db, trip, match.item.id, "skip");
  return {
    reply: `Removed ${match.item.name} from the shortlist.`,
    update: { tripId: trip.id },
  };
}

function plannedPlaces(deps: AgentDeps, found: TripWithCity, data: ItineraryData) {
  const planned = new Set(data.days.flatMap((d) => d.stops.map((s) => s.placeId)));
  return getItineraryPlaces(deps.db, found, data).filter((p) => planned.has(p.id));
}

export type EditOp =
  | { action: "move_up" | "move_down"; place: string }
  | { action: "move_to_day"; place: string; day: number };

/** Itinerary edits by place name; applied in order and saved as one new version. */
export function editItinerary(
  deps: AgentDeps,
  session: AgentSession,
  ops: readonly EditOp[],
): ToolOutcome {
  const found = currentTrip(deps, session);
  if (!found) return { reply: NO_TRIP_REPLY };
  const { trip } = found;
  const latest = getLatestItinerary(deps.db, trip.id);
  if (!latest) return { reply: "There is no itinerary yet: call regenerate_itinerary first." };

  const planned = plannedPlaces(deps, found, latest.data);
  let data = latest.data;
  const results = ops.map((op) => {
    const match = matchByName(planned, op.place);
    if (match.kind !== "found") return describeMiss(match, op.place, "planned");
    const name = match.item.name;
    if (op.action === "move_to_day" && (op.day < 1 || op.day > data.days.length)) {
      return `Day ${op.day} does not exist: the trip has ${daysLabel(data.days.length)}.`;
    }
    const edit: ItineraryEdit =
      op.action === "move_to_day"
        ? { type: "change-day", placeId: match.item.id, day: op.day - 1 }
        : {
            type: "move",
            placeId: match.item.id,
            direction: op.action === "move_up" ? "up" : "down",
          };
    const next = applyItineraryEdit(data, edit);
    if (!next) return `${name} cannot move that way.`;
    data = next;
    return op.action === "move_to_day"
      ? `Moved ${name} to Day ${op.day}.`
      : `Moved ${name} ${op.action === "move_up" ? "earlier" : "later"}.`;
  });

  if (data === latest.data) return { reply: results.join(" ") };
  saveItinerary(deps.db, trip.id, data);
  return { reply: results.join(" "), update: { tripId: trip.id, view: "itinerary" } };
}

/** Plans the shortlist (first plan) or asks the planner for a new one, with optional wishes. */
export async function regenerateItinerary(
  deps: AgentDeps,
  session: AgentSession,
  input: { instructions?: string },
): Promise<ToolOutcome> {
  const found = currentTrip(deps, session);
  if (!found) return { reply: NO_TRIP_REPLY };
  const { trip } = found;
  if (countShortlist(deps.db, trip.id) === 0) {
    return { reply: "The shortlist is empty: the user should like a few places first." };
  }
  const regenerate = getLatestItinerary(deps.db, trip.id) !== undefined;
  const instructions = input.instructions?.trim() || undefined;
  const result = await generateItinerary(deps.db, found, deps.planner, {
    regenerate,
    instructions,
  });
  const planned = result.data.days.reduce((n, d) => n + d.stops.length, 0);
  const placesLabel = `${planned} ${planned === 1 ? "place" : "places"}`;
  const note =
    result.data.source === "fallback"
      ? " The AI planner was unavailable, so it was planned by rules only."
      : "";
  return {
    reply: `${regenerate ? "Planned a new itinerary" : "Planned the itinerary"}: ${placesLabel} over ${daysLabel(trip.days)}.${note}`,
    update: { tripId: trip.id, view: "itinerary" },
  };
}
