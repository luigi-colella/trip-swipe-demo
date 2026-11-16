"use client";

import {
  ArrowDown,
  ArrowUp,
  CalendarDays,
  Footprints,
  MoreVertical,
  Star,
  TrainFront,
  Trash2,
  Utensils,
} from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatDistance } from "@/lib/geo";
import {
  formatClock,
  type DaySchedule,
  type ItineraryDay,
  type ItineraryEdit,
  type ItineraryPlace,
} from "@/lib/itinerary";
import { formatVisitTime, humanizeSlug } from "@/lib/places";

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
        const place = places.get(item.placeId)!;
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
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="-mr-1 size-9 shrink-0"
                  disabled={disabled}
                  aria-label={`Change ${place.name}`}
                >
                  <MoreVertical className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-auto min-w-48">
                <DropdownMenuItem
                  disabled={first}
                  onSelect={() =>
                    onEdit({ type: "move", placeId: place.id, direction: "up" }, place)
                  }
                >
                  <ArrowUp aria-hidden /> Move earlier
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={last}
                  onSelect={() =>
                    onEdit({ type: "move", placeId: place.id, direction: "down" }, place)
                  }
                >
                  <ArrowDown aria-hidden /> Move later
                </DropdownMenuItem>
                {days.length > 1 && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel className="text-xs text-muted-foreground">
                      Move to another day
                    </DropdownMenuLabel>
                    {days.map((title, i) =>
                      i === dayIndex ? null : (
                        <DropdownMenuItem
                          key={i}
                          onSelect={() =>
                            onEdit({ type: "change-day", placeId: place.id, day: i }, place)
                          }
                        >
                          <CalendarDays aria-hidden />
                          <span className="truncate">
                            Day {i + 1} · {title}
                          </span>
                        </DropdownMenuItem>
                      ),
                    )}
                  </>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => onEdit({ type: "remove", placeId: place.id }, place)}
                >
                  <Trash2 aria-hidden /> Remove from plan
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </li>
        );
      })}
    </ol>
  );
}
