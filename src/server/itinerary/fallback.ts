import { truncateText } from "@/lib/places";
import { MAX_TITLE_LENGTH, scheduleDay, type ItineraryData } from "@/lib/itinerary";
import { PACE_LABELS, type Pace } from "@/lib/trip";
import {
  clusterPlaces,
  orderRoute,
  rebalanceGroups,
  selectPlaces,
  type ClusterPlace,
} from "./cluster";

/**
 * Deterministic itinerary (§3.3 B "fallback"): always feasible, no LLM. Also used as the
 * draft the planner model starts from, so a valid AI plan is one small step away.
 */

export type PlannerPlace = ClusterPlace & { name: string; category: string };

export type DraftInput = {
  places: readonly PlannerPlace[];
  days: number;
  pace: Pace;
  budgetMinutes: number;
};

export function didNotFitReason(days: number, pace: Pace): string {
  return `Didn't fit in ${days} ${days === 1 ? "day" : "days"} at a ${PACE_LABELS[pace].toLowerCase()} pace.`;
}

/** Deterministic day title: the two most popular stops, or "Free day". */
export function dayTitle(stops: readonly PlannerPlace[]): string {
  const top = [...stops].sort((a, b) => b.popularity - a.popularity).slice(0, 2);
  if (top.length === 0) return "Free day";
  return truncateText(top.map((p) => p.name).join(" & "), MAX_TITLE_LENGTH);
}

export function buildDraftItinerary({
  places,
  days,
  pace,
  budgetMinutes,
}: DraftInput): ItineraryData {
  const reason = didNotFitReason(days, pace);
  const { kept, excluded } = selectPlaces(places, days * budgetMinutes);
  const groups = rebalanceGroups(clusterPlaces(kept, days), days, budgetMinutes);

  const dropped: PlannerPlace[] = [...excluded];
  const routes = groups.map((group) => {
    let route = orderRoute(group);
    // Trim liked places (least popular first) until the day fits; must-see always stay.
    while (scheduleDay(stopsOf(route), budgetMinutes).overMinutes > 0) {
      const likes = route.filter((p) => !p.must);
      if (likes.length === 0) break;
      const [weakest] = [...likes].sort((a, b) => a.popularity - b.popularity);
      dropped.push(weakest);
      route = orderRoute(route.filter((p) => p !== weakest));
    }
    return route;
  });

  // Fill pass: the selection used average travel times, so some left-out places may still
  // fit somewhere. Try each (most popular first) where it adds the fewest minutes.
  const minutesOf = (route: readonly PlannerPlace[]) =>
    scheduleDay(stopsOf(route), budgetMinutes).activeMinutes;
  for (const place of [...dropped].sort((a, b) => b.popularity - a.popularity)) {
    let best: { day: number; route: PlannerPlace[]; added: number } | undefined;
    routes.forEach((route, day) => {
      const candidate = orderRoute([...route, place]);
      if (scheduleDay(stopsOf(candidate), budgetMinutes).overMinutes > 0) return;
      const added = minutesOf(candidate) - minutesOf(route);
      if (!best || added < best.added) best = { day, route: candidate, added };
    });
    if (best) {
      routes[best.day] = best.route;
      dropped.splice(dropped.indexOf(place), 1);
    }
  }

  routes.sort(
    (a, b) =>
      b.filter((p) => p.must).length - a.filter((p) => p.must).length ||
      b.reduce((s, p) => s + p.popularity, 0) - a.reduce((s, p) => s + p.popularity, 0),
  );

  return {
    days: routes.map((route) => ({
      title: dayTitle(route),
      stops: route.map((p) => ({ placeId: p.id, tip: null })),
    })),
    excluded: dropped.map((p) => ({ placeId: p.id, reason })),
    source: "fallback",
  };
}

function stopsOf(route: readonly ClusterPlace[]) {
  return route.map((p) => ({
    placeId: p.id,
    lat: p.lat,
    lon: p.lon,
    visitMinutes: p.visitMinutes,
  }));
}
