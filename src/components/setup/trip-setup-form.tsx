"use client";

import { useActionState, useState } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { humanizeSlug, INTEREST_TAGS } from "@/lib/places";
import { MAX_DAYS, MIN_DAYS, PACE_HOURS, PACE_LABELS, PACES } from "@/lib/trip";
import { createTripAction, type CreateTripState } from "@/server/actions/trips";
import { CityCombobox, type CitySelection } from "./city-combobox";
import { CONNECTION_ERROR, callServer } from "@/components/call-server";

const DAY_OPTIONS = Array.from({ length: MAX_DAYS - MIN_DAYS + 1 }, (_, i) => MIN_DAYS + i);

/** Visually styled native radios/checkboxes: keyboard and screen-reader support for free. */
const chip =
  "flex cursor-pointer items-center justify-center rounded-lg border bg-background text-sm font-medium transition-colors select-none not-has-checked:hover:bg-muted has-checked:border-foreground has-checked:bg-foreground has-checked:text-background has-focus-visible:ring-3 has-focus-visible:ring-ring/50";

export function TripSetupForm() {
  const [state, formAction, pending] = useActionState(
    (prev: CreateTripState, data: FormData) =>
      callServer(() => createTripAction(prev, data), { error: CONNECTION_ERROR }),
    undefined,
  );
  const [city, setCity] = useState<CitySelection | null>(null);
  const [cityTouched, setCityTouched] = useState(false);
  const cityMissing = cityTouched && !city;

  return (
    <form
      action={formAction}
      className="flex flex-col gap-6"
      onSubmit={(e) => {
        if (!city) {
          e.preventDefault();
          setCityTouched(true);
        }
      }}
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor="city">City</Label>
        <CityCombobox id="city" value={city} onChange={setCity} invalid={cityMissing} />
        <input type="hidden" name="cityQuery" value={city?.query ?? ""} />
        <input type="hidden" name="osmRef" value={city?.city.osmRef ?? ""} />
        {cityMissing && (
          <p className="text-sm text-destructive" role="alert">
            Pick a city from the suggestions.
          </p>
        )}
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">Days</legend>
        <div className="grid grid-cols-7 gap-1.5">
          {DAY_OPTIONS.map((d) => (
            <label key={d} className={cn(chip, "h-10")}>
              <input
                type="radio"
                name="days"
                value={d}
                defaultChecked={d === 3}
                className="sr-only"
              />
              {d}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">Pace</legend>
        <div className="grid grid-cols-3 gap-1.5">
          {PACES.map((p) => (
            <label key={p} className={cn(chip, "h-14 flex-col gap-0.5")}>
              <input
                type="radio"
                name="pace"
                value={p}
                defaultChecked={p === "balanced"}
                className="sr-only"
              />
              {PACE_LABELS[p]}
              <span className="text-xs font-normal opacity-70">{PACE_HOURS[p]} h/day</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">
          Interests <span className="font-normal text-muted-foreground">(optional)</span>
        </legend>
        <div className="flex flex-wrap gap-1.5">
          {INTEREST_TAGS.map((tag) => (
            <label key={tag} className={cn(chip, "h-9 rounded-full px-3.5")}>
              <input type="checkbox" name="interests" value={tag} className="sr-only" />
              {humanizeSlug(tag)}
            </label>
          ))}
        </div>
      </fieldset>

      {state?.error && (
        <p className="text-sm text-destructive" role="alert">
          {state.error}
        </p>
      )}

      <Button type="submit" size="lg" className="h-11 text-base" disabled={pending}>
        {pending && <Loader2 className="animate-spin" aria-hidden />}
        {pending ? "Creating your trip…" : "Start swiping"}
      </Button>
    </form>
  );
}
