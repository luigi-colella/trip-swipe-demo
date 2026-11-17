"use client";

import { lazy, Suspense } from "react";
import { Footprints, Star, TrainFront, Utensils } from "lucide-react";
import { cn } from "cn";
import { formatDistance } from "@/lib/geo";
import {
  formatClock,
  type DaySchedule,
  type ItineraryDay,
  type ItineraryEdit,
  type ItineraryPlace,
} from "@/lib/itinerary";
import { formatVisitTime, humanizeSlug } from "@/lib/places";
import { StopMenuButton } from "./stop-menu-button";
import { defined } from "@/lib/invariant";

const StopActionsMenu = lazy(() => import("./stop-actions-menu"));

/** F4 – One day's timeline: stops with times, legs between them, lunch, quick actions. */
export function DayTimeline({
  dayIndex,
  day,
  schedule,
  days,
  places,
  selectedId,
  disabled,
  onSelect,
  onEdit,
}: {
  dayIndex: number;
  day: ItineraryDay;
  schedule: DaySchedule;
  /** Titles of all days, for "Move to day N". */
  days: readonly string[];
  places: ReadonlyMap<string, ItineraryPlace>;
  selectedId: string | null;
  disabled: boolean;
  onSelect: (placeId: string) => void;
  onEdit: (edit: ItineraryEdit, place: ItineraryPlace) => void;
}) {
  const tips = new Map(day.stops.map((s) => [s.placeId, s.tip]));
  const visits = schedule.items.filter((i) => i.kind === "visit").length;

  if (visits === 0) {
    return (
      <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
        Nothing planned for this day yet. Move a place here from another day.
      </p>
    );
  }

  return (
    <ol className="flex flex-col" aria-label={`Day ${dayIndex + 1} timeline`}>
      {schedule.items.map((item) => {
        if (item.kind === "leg") {
          const Icon = item.mode === "walk" ? Footprints : TrainFront;
          return (
            <li
              key={`leg-${item.start}`}
              className="ml-[1.375rem] flex items-center gap-2 border-l-2 border-dotted py-2 pl-5 text-xs text-muted-foreground"
            >
              <Icon className="size-3.5" aria-hidden />
              {item.minutes} min {item.mode === "walk" ? "walk" : "by public transport"} ·{" "}
              {formatDistance(item.km)}
            </li>
          );
        }
        if (item.kind === "lunch") {
          return (
            <li
              key="lunch"
              className="my-1 flex items-center gap-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900"
            >
              <Utensils className="size-4" aria-hidden />
              <span className="font-medium">Lunch break</span>
              <span className="ml-auto text-xs tabular-nums">
                {formatClock(item.start)} – {formatClock(item.end)}
              </span>
            </li>
          );
        }
        const place = defined(places.get(item.placeId), "a planned place");
        const tip = tips.get(item.placeId);
        const selected = item.placeId === selectedId;
        const first = item.number === 1;
        const last = item.number === visits;
        return (
          <li
            key={item.placeId}
            id={`stop-${item.placeId}`}
            className={cn(
              "flex scroll-mt-4 items-start gap-3 rounded-xl border bg-card p-3 transition-colors",
              selected && "border-rose-400 bg-rose-50/60",
            )}
          >
            <span
              className={cn(
                "flex size-7 shrink-0 items-center justify-center rounded-full bg-rose-600 text-xs font-semibold text-white",
                selected && "bg-foreground",
              )}
              aria-hidden
            >
              {item.number}
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-xs text-muted-foreground tabular-nums">
                {formatClock(item.start)} – {formatClock(item.end)}
              </span>
              <button
                type="button"
                className="w-fit rounded text-left leading-snug font-medium outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                aria-pressed={selected}
                onClick={() => onSelect(item.placeId)}
              >
                <span className="sr-only">Stop {item.number}: </span>
                {place.name}
              </button>
              <span className="flex flex-wrap items-center gap-x-1 text-xs text-muted-foreground">
                {place.must && (
                  <span className="inline-flex items-center gap-0.5 font-medium text-amber-700">
                    <Star className="size-3 fill-amber-400 text-amber-500" aria-hidden />
                    Must-see ·
                  </span>
                )}
                {humanizeSlug(place.category)} · {formatVisitTime(place.visitMinutes)}
              </span>
              {tip && <p className="text-sm text-muted-foreground">{tip}</p>}
            </div>
            {/* The menu code (Radix + positioning) loads after the page: the server-rendered
                button stays in place meanwhile, and a disabled copy stands in on the client. */}
            <Suspense fallback={<StopMenuButton name={place.name} disabled />}>
              <StopActionsMenu
                place={place}
                dayIndex={dayIndex}
                days={days}
                first={first}
                last={last}
                disabled={disabled}
                onEdit={onEdit}
              />
            </Suspense>
          </li>
        );
      })}
    </ol>
  );
}
