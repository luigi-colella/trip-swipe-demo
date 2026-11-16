import { paceMinutes, scheduleItineraryDay } from "@/lib/itinerary";
import { formatVisitTime } from "@/lib/places";
import { PACE_LABELS } from "@/lib/trip";
import type { AppDatabase } from "@/server/db/connection";
import { getItineraryPlaces, getLatestItinerary } from "@/server/itinerary/itineraries";
import { getCityPool } from "@/server/places/discover";
import { buildDeck, getShortlist, getSwipeHistory, getTrip } from "@/server/trips/trips";

/**
 * Compact trip state injected into the agent's system prompt on every model call (§3.3 C), so
 * the model always sees the current trip without tool calls or a long history. Plain text, a
 * few hundred tokens at most.
 */

/** Unswiped places listed as suggestions. */
export const SNAPSHOT_SUGGESTIONS = 8;

export function buildTripSnapshot(db: AppDatabase, tripId: string | null): string {
  const found = tripId ? getTrip(db, tripId) : undefined;
  if (!found) return "No trip yet (the user is on the home page).";
  const { trip, city } = found;
  const budget = paceMinutes(trip.pace);

  const lines = [
    `City: ${city.name}, ${city.country}`,
    `Days: ${trip.days} · Pace: ${PACE_LABELS[trip.pace].toLowerCase()} (${formatVisitTime(budget)} of visits and travel per day)`,
    `Interests: ${trip.interests.length ? trip.interests.join(", ") : "none"}`,
    `Step: ${trip.status}`,
  ];

  const shortlist = getShortlist(db, trip.id);
  lines.push(
    `Shortlist: ${shortlist.length ? shortlist.map((e) => (e.decision === "must" ? `${e.place.name} (must-see)` : e.place.name)).join(", ") : "empty"}`,
  );

  const latest = getLatestItinerary(db, trip.id);
  if (latest) {
    const places = getItineraryPlaces(db, found, latest.data);
    const byId = new Map(places.map((p) => [p.id, p]));
    lines.push("Itinerary:");
    latest.data.days.forEach((day, i) => {
      const schedule = scheduleItineraryDay(day, byId, budget);
      // Itineraries only reference places of the trip's city (like the itinerary view).
      const stops = day.stops.map((s) => byId.get(s.placeId)!.name);
      lines.push(
        `- Day ${i + 1} "${day.title}" (${formatVisitTime(schedule.activeMinutes)}): ${stops.length ? stops.join(", ") : "free day"}`,
      );
    });
    const excluded = latest.data.excluded.map((x) => `${byId.get(x.placeId)!.name} (${x.reason})`);
    if (excluded.length) lines.push(`Excluded: ${excluded.join("; ")}`);
  }

  const { deck } = buildDeck(
    getCityPool(db, city.id),
    getSwipeHistory(db, trip.id),
    trip.interests,
  );
  if (deck.length) {
    const names = deck.slice(0, SNAPSHOT_SUGGESTIONS).map((p) => p.name);
    lines.push(`Not swiped yet (${deck.length}), best first: ${names.join(", ")}`);
  }
  return lines.join("\n");
}
