"use client";

import { ErrorState } from "@/components/trip/error-state";

export default function SwipeError({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <ErrorState
      error={error}
      retry={retry}
      title="We couldn't load the places"
      message="Finding attractions for this city failed. This is usually temporary: please try again in a moment."
    />
  );
}
