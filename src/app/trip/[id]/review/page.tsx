import { Suspense } from "react";
import type { Metadata } from "next";
import { Shortlist } from "@/components/review/shortlist";
import { ListSkeleton, TripHeaderSkeleton } from "@/components/trip/skeletons";
import { TripHeader } from "@/components/trip/trip-header";
import { db } from "@/server/db/client";
import { loadTripOr404 } from "@/server/trips/load";
import { getShortlist } from "@/server/trips/trips";

export const metadata: Metadata = { title: "Review · TravelSwipe AI" };

/** F10 – Shortlist review between Swipe and Itinerary. */
export default function ReviewPage({ params }: PageProps<"/trip/[id]/review">) {
  return (
    <Suspense
      fallback={
        <>
          <TripHeaderSkeleton />
          <ListSkeleton />
        </>
      }
    >
      {params.then(({ id }) => (
        <ReviewContent id={id} />
      ))}
    </Suspense>
  );
}

async function ReviewContent({ id }: { id: string }) {
  const { trip, city } = await loadTripOr404(id);
  return (
    <>
      <TripHeader
        tripId={trip.id}
        city={city.name}
        days={trip.days}
        pace={trip.pace}
        status={trip.status}
        current="review"
      />
      <Shortlist tripId={trip.id} entries={getShortlist(db, trip.id)} />
    </>
  );
}
