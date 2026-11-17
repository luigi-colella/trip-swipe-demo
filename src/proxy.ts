import { NextResponse, type NextRequest } from "next/server";
import { isTripId } from "@/lib/trip";
import { db } from "@/server/db/client";
import { getTrip } from "@/server/trips/trips";

/**
 * Unknown trips answer 404 (defensive programming, AGENTS.md). The trip pages stream their
 * prerendered shell first, which fixes the status at 200 before the page can call notFound():
 * the check has to run before rendering. A rewrite to a path no route matches renders the
 * root not-found page with a 404. Only page loads are checked: Server Actions answer for
 * themselves (they validate the trip).
 */
export const NOT_FOUND_PATH = "/_trip-not-found";

export function proxy(request: NextRequest) {
  if (request.method !== "GET" && request.method !== "HEAD") return NextResponse.next();
  const id = request.nextUrl.pathname.split("/")[2];
  if (isTripId(id) && getTrip(db, id)) return NextResponse.next();
  return NextResponse.rewrite(new URL(NOT_FOUND_PATH, request.url));
}

export const config = { matcher: ["/trip/:id", "/trip/:id/:path*"] };
