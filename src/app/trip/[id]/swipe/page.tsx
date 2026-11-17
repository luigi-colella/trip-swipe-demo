import { Suspense } from "react";
import type { Metadata } from "next";
import { SwipeDeck } from "@/components/swipe/swipe-deck";
import { AiBusyState } from "@/components/trip/error-state";
import { DeckSkeleton, TripHeaderSkeleton } from "@/components/trip/skeletons";
import { TripHeader } from "@/components/trip/trip-header";
import { deckVersion } from "@/lib/deck";
import { aiBusyText, isAiBusyError } from "@/server/ai/budget";
import { llmBudget } from "@/server/ai/runtime";
import { db } from "@/server/db/client";
import { findPlacesForTrip, type Place } from "@/server/places/discover";
import { discoveryDeps } from "@/server/places/deps";
import { loadTripOr404 } from "@/server/trips/load";
import { buildDeck, getSwipeHistory, type TripWithCity } from "@/server/trips/trips";

export const metadata: Metadata = { title: "Swipe · TripSwipe AI" };

/** F2/F3: the header streams first; the deck may wait for place discovery on a new city. */
export default function SwipePage({ params }: PageProps<"/trip/[id]/swipe">) {
  return (
    <Suspense
      fallback={
        <>
          <TripHeaderSkeleton />
          <DeckSkeleton />
        </>
      }
    >
      {params.then(({ id }) => (
        <SwipeContent id={id} />
      ))}
    </Suspense>
  );
}

async function SwipeContent({ id }: { id: string }) {
  const found = await loadTripOr404(id);
  const { trip, city } = found;
  return (
    <>
      <TripHeader
        tripId={trip.id}
        city={city.name}
        days={trip.days}
        pace={trip.pace}
        status={trip.status}
        current="swipe"
      />
      <Suspense fallback={<DeckSkeleton message={`Finding the best of ${city.name}…`} />}>
        <Deck found={found} />
      </Suspense>
    </>
  );
}

async function Deck({ found: { trip, city } }: { found: TripWithCity }) {
  // Cache-first: one LLM call only the first time anyone opens this city.
  let pool: Place[];
  try {
    pool = await findPlacesForTrip(city, trip.interests, discoveryDeps);
  } catch (err) {
    if (isAiBusyError(err)) return <AiBusyState message={aiBusyText(llmBudget)} />;
    throw err;
  }
  const { deck, history } = buildDeck(pool, getSwipeHistory(db, trip.id), trip.interests);
  return (
    <SwipeDeck
      // Remounts with the server's state when the chat agent changed the deck.
      key={deckVersion(deck, history)}
      tripId={trip.id}
      interests={trip.interests}
      initialDeck={deck}
      initialHistory={history}
    />
  );
}
