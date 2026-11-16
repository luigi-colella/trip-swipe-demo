import { eq } from "drizzle-orm";
import { slugify } from "@/lib/places";
import type { AppDatabase } from "@/server/db/connection";
import { cities } from "@/server/db/schema";
import type { CitySuggestion } from "./photon";

export type City = typeof cities.$inferSelect;

/** "rome-lazio-it": name + region + country keeps homonyms (Springfield, US) apart. */
export function citySlug(c: Pick<CitySuggestion, "name" | "state" | "countryCode">): string {
  return slugify([c.name, c.state, c.countryCode].filter(Boolean).join(" "));
}

/** Returns the stored city for a Photon suggestion, creating it on first use. */
export function upsertCity(db: AppDatabase, suggestion: CitySuggestion): City {
  const slug = citySlug(suggestion);
  db.insert(cities)
    .values({
      id: crypto.randomUUID(),
      slug,
      name: suggestion.name,
      country: suggestion.country,
      lat: suggestion.lat,
      lon: suggestion.lon,
    })
    .onConflictDoNothing({ target: cities.slug })
    .run();
  return db.select().from(cities).where(eq(cities.slug, slug)).get()!;
}
