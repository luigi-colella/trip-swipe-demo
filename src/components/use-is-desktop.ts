"use client";

import { useSyncExternalStore } from "react";

/** Two-pane layouts (itinerary list + map, chat beside the page) start at Tailwind's `lg`. */
export const DESKTOP_QUERY = "(min-width: 1024px)";

/** Live `lg` breakpoint match; false while server rendering. */
export function useIsDesktop(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(DESKTOP_QUERY);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia(DESKTOP_QUERY).matches,
    () => false,
  );
}
