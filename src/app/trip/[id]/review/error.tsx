"use client";

import { ErrorState } from "@/components/trip/error-state";

export default function ReviewError({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <ErrorState
      error={error}
      retry={retry}
      title="We couldn't load your shortlist"
      message="Something went wrong while loading this trip. Please try again."
    />
  );
}
