import { formatVisitTime, truncateText } from "@/lib/places";
import {
  MAX_REASON_LENGTH,
  MAX_TIP_LENGTH,
  MAX_TITLE_LENGTH,
  scheduleDay,
  type ItineraryData,
} from "@/lib/itinerary";
import type { PlannerOutput } from "@/server/ai/prompts";
import { orderRoute, travelMinutes } from "./cluster";
import { dayTitle, type PlannerPlace } from "./fallback";

/**
 * §3.3 B "validate": maps the planner's short IDs back to places and checks everything code
 * can check. Errors are phrased for the model, which gets them back in the repair loop.
 */

export type PlanContext = {
  /** Shortlist places keyed by their short alias (P1, P2…). */
  places: ReadonlyMap<string, PlannerPlace>;
  days: number;
  budgetMinutes: number;
};

export type ValidationResult =
  { data: ItineraryData; errors: [] } | { data?: undefined; errors: string[] };

const label = (alias: string, p: PlannerPlace) => `${alias} (${p.name})`;

/**
 * The model's order is kept unless its travel time exceeds the shortest route by more than
 * both of these: then code re-orders the day (tips stay with their places).
 */
export const MAX_DETOUR_RATIO = 0.25;
export const MAX_DETOUR_MINUTES = 15;

/** Returns the shortest route when the given order is a clear detour, otherwise the route. */
export function fixDetours<T extends PlannerPlace>(route: readonly T[]): T[] {
  const best = orderRoute(route);
  const extra = travelMinutes(route) - travelMinutes(best);
  const tolerated = Math.max(MAX_DETOUR_MINUTES, MAX_DETOUR_RATIO * travelMinutes(best));
  return extra > tolerated ? best : [...route];
}

/**
 * Tabs already say "Day N": drop a "Day N –" prefix, and replace a bare "Day N" (or nothing)
 * with the deterministic title built from the stops.
 */
export function cleanDayTitle(title: string, stops: readonly PlannerPlace[]): string {
  const text = truncateText(
    title.replace(/^\s*day\s*\d+\s*(?:[-–—:·|]\s*)?/i, ""),
    MAX_TITLE_LENGTH,
  );
  return text || dayTitle(stops);
}
const normalizeAlias = (id: string) => id.trim().toUpperCase();

export function validatePlan(output: PlannerOutput, ctx: PlanContext): ValidationResult {
  const errors: string[] = [];
  const used = new Set<string>();

  const take = (rawId: string): PlannerPlace | undefined => {
    const alias = normalizeAlias(rawId);
    const place = ctx.places.get(alias);
    if (!place) {
      errors.push(`Unknown place ID "${truncateText(rawId, 20)}": use only IDs from the list.`);
      return undefined;
    }
    if (used.has(alias)) {
      errors.push(`${label(alias, place)} is used more than once.`);
      return undefined;
    }
    used.add(alias);
    return place;
  };

  if (output.days.length > ctx.days) {
    errors.push(`Return exactly ${ctx.days} days, not ${output.days.length}.`);
  }

  const days = output.days.slice(0, ctx.days).map((day, i) => {
    const tips = new Map<string, string | null>();
    const planned = day.stops.flatMap((s) => {
      const place = take(s.id);
      if (place) tips.set(place.id, truncateText(s.tip, MAX_TIP_LENGTH) || null);
      return place ? [place] : [];
    });
    const stops = fixDetours(planned).map((place) => ({ place, tip: tips.get(place.id) ?? null }));
    const schedule = scheduleDay(
      stops.map(({ place }) => ({ placeId: place.id, ...place })),
      ctx.budgetMinutes,
    );
    if (schedule.overMinutes > 0 && stops.some(({ place }) => !place.must)) {
      errors.push(
        `Day ${i + 1} needs ${formatVisitTime(schedule.activeMinutes)} of visits and travel, ` +
          `${formatVisitTime(schedule.overMinutes)} over the daily budget: move liked places to a lighter day or exclude them.`,
      );
    }
    return {
      title: cleanDayTitle(day.title, planned),
      stops: stops.map(({ place, tip }) => ({ placeId: place.id, tip })),
    };
  });
  while (days.length < ctx.days) days.push({ title: dayTitle([]), stops: [] });

  const excluded = output.excluded.flatMap((x) => {
    const alias = normalizeAlias(x.id);
    const place = take(x.id);
    if (!place) return [];
    if (place.must) {
      errors.push(`${label(alias, place)} is a must-see: it cannot be excluded.`);
      return [];
    }
    const reason = truncateText(x.reason, MAX_REASON_LENGTH) || "Left out by the planner.";
    return [{ placeId: place.id, reason }];
  });

  for (const [alias, place] of ctx.places) {
    if (!used.has(alias))
      errors.push(`${label(alias, place)} is missing: put it in a day or in "excluded".`);
  }

  if (errors.length) return { errors };
  return { data: { days, excluded, source: "ai" }, errors: [] };
}
