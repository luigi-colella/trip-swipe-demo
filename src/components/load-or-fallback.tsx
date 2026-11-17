import type { ComponentType } from "react";

/**
 * Loader for `next/dynamic` that never breaks the page: code split off the first load can
 * fail to arrive (offline, a dropped connection, a new deployment). Instead of reaching the
 * error boundary, the part of the page that needed it explains what is missing.
 */
export function loadOrFallback<P>(
  load: () => Promise<{ default: ComponentType<P> }>,
  what: string,
): () => Promise<ComponentType<P>> {
  return () =>
    load().then(
      (m) => m.default,
      (err: unknown) => {
        console.error(`Could not load ${what}`, err);
        return function Unavailable() {
          return (
            <p
              role="alert"
              className="m-4 rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground"
            >
              Couldn&apos;t load {what}. Check your connection and reload the page.
            </p>
          );
        };
      },
    );
}
