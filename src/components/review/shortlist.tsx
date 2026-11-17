"use client";

import { useOptimistic, useTransition } from "react";
import Link from "next/link";
import { ArrowLeft, Clock, LoaderCircle, Sparkles, Star, Trash2 } from "lucide-react";
import { toast } from "@/components/toast";
import { cn } from "cn";
import { PlacePhoto } from "@/components/swipe/place-photo";
import { Button } from "@/components/ui/button";
import type { DeckEntry } from "@/lib/deck";
import { formatVisitTime, humanizeSlug } from "@/lib/places";
import type { SwipeDecision } from "@/lib/trip";
import { generateItineraryAction } from "@/server/actions/itinerary";
import { updateShortlistAction } from "@/server/actions/trips";

type Change = { placeId: string; decision: SwipeDecision };

function applyChange(entries: DeckEntry[], change: Change): DeckEntry[] {
  if (change.decision === "skip") return entries.filter((e) => e.place.id !== change.placeId);
  return entries.map((e) =>
    e.place.id === change.placeId ? { ...e, decision: change.decision } : e,
  );
}

/** F10: liked and must-see places; promote, demote or remove before planning. */
export function Shortlist({ tripId, entries }: { tripId: string; entries: DeckEntry[] }) {
  const [optimistic, apply] = useOptimistic(entries, applyChange);
  const [, startTransition] = useTransition();
  const [planning, startPlanning] = useTransition();
  const swipeHref = `/trip/${tripId}/swipe`;

  function generate() {
    startPlanning(async () => {
      // Redirects to the itinerary on success.
      const r = await generateItineraryAction(tripId);
      if (!r.ok) toast.error(r.error);
    });
  }

  function change(entry: DeckEntry, decision: SwipeDecision) {
    startTransition(async () => {
      apply({ placeId: entry.place.id, decision });
      const r = await updateShortlistAction(tripId, entry.place.id, decision);
      if (!r.ok) toast.error(`Couldn't update ${entry.place.name}. Please try again.`);
    });
  }

  const mustCount = optimistic.filter((e) => e.decision === "must").length;

  if (optimistic.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 py-12 text-center">
        <Sparkles className="size-8 text-rose-400" aria-hidden />
        <div className="flex flex-col gap-1">
          <h2 className="font-semibold">Your shortlist is empty</h2>
          <p className="text-sm text-muted-foreground">Like a few places to plan your trip.</p>
        </div>
        <Button asChild>
          <Link href={swipeHref}>Back to swiping</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        {optimistic.length} {optimistic.length === 1 ? "place" : "places"} · {mustCount} must-see
      </p>
      <ul className="flex flex-col gap-2" aria-label="Shortlist">
        {optimistic.map((entry) => {
          const { place } = entry;
          const must = entry.decision === "must";
          return (
            <li key={place.id} className="flex items-center gap-3 rounded-xl border bg-card p-2">
              <div className="relative size-16 shrink-0 overflow-hidden rounded-lg bg-muted">
                <PlacePhoto src={place.imageUrl} alt={place.name} sizes="64px" />
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="line-clamp-2 leading-snug font-medium">{place.name}</span>
                <span className="flex flex-wrap items-center gap-x-1 text-xs text-muted-foreground">
                  {must && <span className="font-medium text-amber-700">Must-see ·</span>}
                  {humanizeSlug(place.category)} · <Clock className="size-3" aria-hidden />
                  {formatVisitTime(place.visitMinutes)}
                </span>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="size-10"
                aria-pressed={must}
                aria-label={
                  must ? `Unmark ${place.name} as must-see` : `Mark ${place.name} as must-see`
                }
                title={must ? "Unmark must-see" : "Mark as must-see"}
                onClick={() => change(entry, must ? "like" : "must")}
              >
                <Star
                  className={cn(
                    "size-5",
                    must ? "fill-amber-400 text-amber-500" : "text-muted-foreground",
                  )}
                />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-10 text-muted-foreground hover:text-destructive"
                aria-label={`Remove ${place.name}`}
                title="Remove"
                onClick={() => change(entry, "skip")}
              >
                <Trash2 className="size-5" />
              </Button>
            </li>
          );
        })}
      </ul>

      <div className="mt-auto flex flex-col gap-2 pt-2 sm:flex-row-reverse sm:items-center">
        <Button size="lg" className="h-11 sm:flex-1" disabled={planning} onClick={generate}>
          {planning && (
            <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden />
          )}
          {planning ? "Planning your trip…" : "Generate itinerary"}
        </Button>
        <Button variant="outline" size="lg" className="h-11" asChild>
          <Link href={swipeHref}>
            <ArrowLeft aria-hidden />
            Keep swiping
          </Link>
        </Button>
      </div>
      <p className="text-center text-xs text-muted-foreground" aria-live="polite">
        {planning
          ? "The AI is arranging your days; this can take a couple of minutes."
          : "The AI groups nearby places into days; you can fine-tune the plan afterwards."}
      </p>
    </div>
  );
}
