"use client";

import { ArrowDown, ArrowUp, CalendarDays, Trash2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ItineraryEdit, ItineraryPlace } from "@/lib/itinerary";
import { StopMenuButton } from "./stop-menu-button";

/** F4 quick actions of one stop: move within the day, to another day, or remove it. */
export default function StopActionsMenu({
  place,
  dayIndex,
  days,
  first,
  last,
  disabled,
  onEdit,
}: {
  place: ItineraryPlace;
  dayIndex: number;
  /** Titles of all days, for "Move to day N". */
  days: readonly string[];
  first: boolean;
  last: boolean;
  disabled: boolean;
  onEdit: (edit: ItineraryEdit, place: ItineraryPlace) => void;
}) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <StopMenuButton name={place.name} disabled={disabled} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto min-w-48">
        <DropdownMenuItem
          disabled={first}
          onSelect={() => onEdit({ type: "move", placeId: place.id, direction: "up" }, place)}
        >
          <ArrowUp aria-hidden /> Move earlier
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={last}
          onSelect={() => onEdit({ type: "move", placeId: place.id, direction: "down" }, place)}
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
                  onSelect={() => onEdit({ type: "change-day", placeId: place.id, day: i }, place)}
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
  );
}
