import "server-only";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { TripIdSchema } from "@/lib/trip";
import { db } from "@/server/db/client";
import { getTrip, type TripWithCity } from "./trips";

/** Reads the trip for a /trip/[id] page, or renders the not-found page. */
export async function loadTripOr404(id: string): Promise<TripWithCity> {
  // SQLite reads are synchronous: opt out of build-time prerendering first.
  await connection();
  const parsed = TripIdSchema.safeParse(id);
  const found = parsed.success ? getTrip(db, parsed.data) : undefined;
  if (!found) notFound();
  return found;
}
