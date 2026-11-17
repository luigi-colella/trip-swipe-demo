import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ItineraryView } from "@/components/itinerary/itinerary-view";
import { ListSkeleton, TripHeaderSkeleton } from "@/components/trip/skeletons";
import { TripHeader } from "@/components/trip/trip-header";
import { db } from "@/server/db/client";
import { getItineraryPlaces, getLatestItinerary } from "@/server/itinerary/itineraries";
import { loadTripOr404 } from "@/server/trips/load";

export const metadata: Metadata = { title: "Itinerary · TripSwipe AI" };

/** F4/F5/F7 – The latest itinerary version, with the map beside it on wide screens. */
export default function ItineraryPage({ params }: PageProps<"/trip/[id]/itinerary">) {
  return (
    // data-wide: the root layout widens its column for the list + map layout.
    <div data-wide className="contents">
      <Suspense
        fallback={
          <>
            <TripHeaderSkeleton />
            <ListSkeleton />
          </>
        }
      >
        {params.then(({ id }) => (
          <ItineraryContent id={id} />
        ))}
      </Suspense>
    </div>
  );
}

async function ItineraryContent({ id }: { id: string }) {
  const found = await loadTripOr404(id);
  const { trip, city } = found;
  const latest = getLatestItinerary(db, trip.id);
  if (!latest) redirect(`/trip/${trip.id}/review`);
  return (
    <>
      <TripHeader
        tripId={trip.id}
        city={city.name}
        days={trip.days}
        pace={trip.pace}
        status={trip.status}
        current="itinerary"
      />
      <ItineraryView
        tripId={trip.id}
        pace={trip.pace}
        data={latest.data}
        canUndo={latest.versions > 1}
        places={getItineraryPlaces(db, found, latest.data)}
        center={{ lat: city.lat, lon: city.lon }}
      />
    </>
  );
}
