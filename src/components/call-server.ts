import { unstable_rethrow } from "next/navigation";

/** Shown when a Server Action never got an answer (offline, server down, dropped connection). */
export const CONNECTION_ERROR = "Couldn't reach the server. Check your connection and try again.";

/** A request that never got an answer rejects with a TypeError ("Failed to fetch"). */
export function requestErrorText(error: Error): string {
  return error instanceof TypeError ? CONNECTION_ERROR : error.message;
}

/** The failure every `ActionResult` caller already handles. */
export const CONNECTION_FAILURE = { ok: false as const, error: CONNECTION_ERROR };

/**
 * Calls a Server Action from the UI. Actions report their own failures as results, but the
 * request itself can fail (network down): that rejection would otherwise reach the error
 * boundary and replace the page. It becomes `fallback` instead, so the caller shows it like any
 * other failure. Next.js control flow (an action's redirect) is rethrown untouched.
 */
export async function callServer<T>(call: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await call();
  } catch (err) {
    unstable_rethrow(err);
    console.error("Server Action failed", err);
    return fallback;
  }
}
