import { z } from "zod";
import { estimateLeg, type LatLon, type Leg } from "./geo";
import type { PlaceCard } from "./places";
import { MAX_DAYS, PACE_HOURS, type Pace } from "./trip";

/**
 * Itinerary model (F4) shared by the server and the client. A version stores only the
 * arrangement (days, order, notes, excluded places); times, legs, lunch and pace warnings are
 * always computed by `scheduleDay`, so the client can re-schedule instantly after a quick
 * action and the server validates exactly what the user will see.
 */

export const ITINERARY_SOURCES = ["ai", "fallback"] as const;
export type ItinerarySource = (typeof ITINERARY_SOURCES)[number];

export const MAX_TITLE_LENGTH = 60;
export const MAX_TIP_LENGTH = 140;
export const MAX_REASON_LENGTH = 140;

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
export type ItineraryDay = ItineraryData["days"][number];
export type ItineraryStop = ItineraryDay["stops"][number];

/** What the itinerary UI needs about a place: the card plus coordinates and must-see flag. */
export type ItineraryPlace = PlaceCard & LatLon & { must: boolean };

// --- Schedule ----------------------------------------------------------------------------

/** Minutes after midnight. */
export const DAY_START = 9 * 60;
/** Lunch starts after the stop in progress at 12:30… */
export const LUNCH_FROM = 12 * 60 + 30;
/** …and no later than 14:00: a stop that would push it later waits until after lunch, */
export const LUNCH_LATEST = 14 * 60;
/** …unless it is too early for lunch (then lunch follows that stop, as late as needed). */
export const LUNCH_EARLIEST = 11 * 60 + 30;
export const LUNCH_MINUTES = 60;

/** Active minutes per day for a pace: visits + travel, lunch excluded (F1). */
export function paceMinutes(pace: Pace): number {
  return PACE_HOURS[pace] * 60;
}

export type ScheduleStop = LatLon & { placeId: string; visitMinutes: number };

export type TimelineItem =
  | { kind: "visit"; placeId: string; number: number; start: number; end: number }
  | ({ kind: "leg"; start: number; end: number } & Leg)
  | { kind: "lunch"; start: number; end: number };

export type DaySchedule = {
  items: TimelineItem[];
  start: number;
  end: number;
  /** Visits + travel. */
  activeMinutes: number;
  /** Active minutes beyond the pace budget (0 when the day fits). */
  overMinutes: number;
};

/** Timeline of one day: 09:00 start, legs between stops, a lunch break between two stops. */
export function scheduleDay(stops: readonly ScheduleStop[], budgetMinutes: number): DaySchedule {
  const items: TimelineItem[] = [];
  let t = DAY_START;
  let active = 0;
  let lunchDone = false;
  stops.forEach((stop, i) => {
    const prev = stops[i - 1];
    const leg = prev ? estimateLeg(prev, stop) : null;
    if (leg && !lunchDone) {
      const endWithoutLunch = t + leg.minutes + stop.visitMinutes;
      if (t >= LUNCH_FROM || (t >= LUNCH_EARLIEST && endWithoutLunch > LUNCH_LATEST)) {
        items.push({ kind: "lunch", start: t, end: t + LUNCH_MINUTES });
        t += LUNCH_MINUTES;
        lunchDone = true;
      }
    }
    if (leg && leg.minutes > 0) {
      items.push({ kind: "leg", start: t, end: t + leg.minutes, ...leg });
      t += leg.minutes;
      active += leg.minutes;
    }
    items.push({
      kind: "visit",
      placeId: stop.placeId,
      number: i + 1,
      start: t,
      end: t + stop.visitMinutes,
    });
    t += stop.visitMinutes;
    active += stop.visitMinutes;
  });
  return {
    items,
    start: DAY_START,
    end: t,
    activeMinutes: active,
    overMinutes: Math.max(0, active - budgetMinutes),
  };
}

/** Schedules a stored day against the places it references (unknown places are skipped). */
export function scheduleItineraryDay(
  day: ItineraryDay,
  places: ReadonlyMap<string, Pick<ItineraryPlace, "lat" | "lon" | "visitMinutes">>,
  budgetMinutes: number,
): DaySchedule {
  const stops = day.stops.flatMap((s) => {
    const p = places.get(s.placeId);
    return p ? [{ placeId: s.placeId, lat: p.lat, lon: p.lon, visitMinutes: p.visitMinutes }] : [];
  });
  return scheduleDay(stops, budgetMinutes);
}

/** 570 → "09:30". */
export function formatClock(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// --- Quick actions -----------------------------------------------------------------------

/** Deterministic edits (F4 quick actions; also the agent's edit_itinerary ops in M4). */
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

export const REMOVED_BY_USER_REASON = "Removed by you.";

export function findStop(
  data: ItineraryData,
  placeId: string,
): { day: number; index: number } | undefined {
  for (const [day, d] of data.days.entries()) {
    const index = d.stops.findIndex((s) => s.placeId === placeId);
    if (index !== -1) return { day, index };
  }
  return undefined;
}

/** Applies a quick action; returns null when it does not apply (unknown stop, no-op move). */
export function applyItineraryEdit(data: ItineraryData, edit: ItineraryEdit): ItineraryData | null {
  const at = findStop(data, edit.placeId);
  if (!at) return null;
  const days = data.days.map((d) => ({ ...d, stops: [...d.stops] }));
  const stops = days[at.day].stops;
  switch (edit.type) {
    case "remove": {
      stops.splice(at.index, 1);
      return {
        ...data,
        days,
        excluded: [...data.excluded, { placeId: edit.placeId, reason: REMOVED_BY_USER_REASON }],
      };
    }
    case "move": {
      const to = at.index + (edit.direction === "up" ? -1 : 1);
      if (to < 0 || to >= stops.length) return null;
      [stops[at.index], stops[to]] = [stops[to], stops[at.index]];
      return { ...data, days };
    }
    case "change-day": {
      if (edit.day === at.day || edit.day >= days.length) return null;
      const [stop] = stops.splice(at.index, 1);
      days[edit.day].stops.push(stop);
      return { ...data, days };
    }
  }
}
