import type { LatLon } from "@/lib/geo";
import { scheduleDay, type ItineraryData } from "@/lib/itinerary";

/**
 * Adds one place to an existing itinerary without the LLM (agent `add_place`): cheapest
 * insertion that keeps the day within budget, existing stops keep their order. A must-see
 * that fits nowhere still goes where it overflows least; a liked place is listed as excluded.
 */

export type InsertablePlace = LatLon & { id: string; visitMinutes: number; must: boolean };

export type InsertResult =
  | { kind: "added"; data: ItineraryData; day: number }
  | { kind: "excluded"; data: ItineraryData }
  | { kind: "already-planned"; day: number };

type Candidate = { day: number; index: number; added: number; over: number };

export function insertIntoItinerary(
  data: ItineraryData,
  place: InsertablePlace,
  places: ReadonlyMap<string, LatLon & { visitMinutes: number }>,
  budgetMinutes: number,
  notFitReason: string,
): InsertResult {
  const planned = data.days.findIndex((d) => d.stops.some((s) => s.placeId === place.id));
  if (planned !== -1) return { kind: "already-planned", day: planned };

  const stopsOf = (ids: readonly string[]) =>
    ids.flatMap((id) => {
      const p = id === place.id ? place : places.get(id);
      return p ? [{ placeId: id, lat: p.lat, lon: p.lon, visitMinutes: p.visitMinutes }] : [];
    });

  let fit: Candidate | undefined;
  let leastOver: Candidate | undefined;
  data.days.forEach((d, day) => {
    const ids = d.stops.map((s) => s.placeId);
    const before = scheduleDay(stopsOf(ids), budgetMinutes).activeMinutes;
    for (let index = 0; index <= ids.length; index++) {
      const schedule = scheduleDay(
        stopsOf([...ids.slice(0, index), place.id, ...ids.slice(index)]),
        budgetMinutes,
      );
      const c = { day, index, added: schedule.activeMinutes - before, over: schedule.overMinutes };
      if (c.over === 0 && (!fit || c.added < fit.added)) fit = c;
      if (!leastOver || c.over < leastOver.over) leastOver = c;
    }
  });

  const excluded = data.excluded.filter((x) => x.placeId !== place.id);
  const target = fit ?? (place.must ? leastOver : undefined);
  if (!target) {
    return {
      kind: "excluded",
      data: { ...data, excluded: [...excluded, { placeId: place.id, reason: notFitReason }] },
    };
  }
  const days = data.days.map((d, i) => {
    if (i !== target.day) return d;
    const stops = [...d.stops];
    stops.splice(target.index, 0, { placeId: place.id, tip: null });
    return { ...d, stops };
  });
  return { kind: "added", data: { ...data, days, excluded }, day: target.day };
}
