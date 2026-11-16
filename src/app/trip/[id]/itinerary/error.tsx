"use client";

import { ErrorState } from "@/components/trip/error-state";

export default function ItineraryError({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <ErrorState
      error={error}
      retry={retry}
      title="We couldn't load your itinerary"
      message="Something went wrong while loading this trip. Please try again."
    />
  );
}
