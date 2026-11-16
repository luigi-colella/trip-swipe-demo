import type { ItineraryPlace } from "@/lib/itinerary";
import type { PlaceCard } from "@/lib/places";

export const TRIP_ID = "00000000-0000-4000-8000-000000000001";

let n = 0;
/** A place card with a unique UUID; override any field. */
export function placeCard(name: string, extra: Partial<PlaceCard> = {}): PlaceCard {
  n++;
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    name,
    category: "historic-site",
    tags: ["history"],
    pitch: `${name} pitch.`,
    visitMinutes: 90,
    popularity: 100,
    wikiUrl: `https://en.wikipedia.org/wiki/${encodeURIComponent(name)}`,
    imageUrl: null,
    imageAuthor: null,
    imageLicense: null,
    imageLicenseUrl: null,
    imagePageUrl: null,
    ...extra,
  };
}

export function itineraryPlace(
  name: string,
  lat: number,
  lon: number,
  extra: Partial<ItineraryPlace> = {},
): ItineraryPlace {
  return { ...placeCard(name), lat, lon, must: false, ...extra };
}
