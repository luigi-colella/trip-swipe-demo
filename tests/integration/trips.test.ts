import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { places } from "@/server/db/schema";
import { upsertCity, type City } from "@/server/places/cities";
import type { Place } from "@/server/places/discover";
import {
  buildDeck,
  countShortlist,
  createTrip,
  getShortlist,
  getSwipeHistory,
  getTrip,
  recordSwipe,
  removeSwipe,
  setTripStatus,
  type Trip,
} from "@/server/trips/trips";
import { createTestDatabase } from "../helpers/db";

let t: ReturnType<typeof createTestDatabase>;
let rome: City;
let paris: City;
let trip: Trip;

const suggestion = (name: string, osmRef: string) => ({
  osmRef,
  name,
  state: null,
  country: "Country",
  countryCode: "XX",
  lat: 0,
  lon: 0,
});

function addPlace(city: City, name: string, extra: Partial<Place> = {}): Place {
  return t.db
    .insert(places)
    .values({
      id: crypto.randomUUID(),
      cityId: city.id,
      wikiTitle: name,
      wikiUrl: `https://en.wikipedia.org/wiki/${encodeURIComponent(name)}`,
      name,
      category: "landmark",
      tags: [],
      pitch: `${name} pitch`,
      lat: 0,
      lon: 0,
      visitMinutes: 60,
      popularity: 100,
      ...extra,
    })
    .returning()
    .get();
}

beforeEach(() => {
  t = createTestDatabase();
  rome = upsertCity(t.db, suggestion("Rome", "R1"));
  paris = upsertCity(t.db, suggestion("Paris", "R2"));
  trip = createTrip(t.db, { cityId: rome.id, days: 3, pace: "balanced", interests: ["art"] });
});
afterEach(() => t.cleanup());

describe("trips", () => {
  it("creates a trip in the swiping step and reads it with its city", () => {
    const found = getTrip(t.db, trip.id);
    expect(found?.trip).toMatchObject({ days: 3, pace: "balanced", interests: ["art"] });
    expect(found?.trip.status).toBe("swiping");
    expect(found?.city.name).toBe("Rome");
    expect(getTrip(t.db, crypto.randomUUID())).toBeUndefined();

    setTripStatus(t.db, trip.id, "review");
    expect(getTrip(t.db, trip.id)?.trip.status).toBe("review");
  });

  it("records swipes in order and lets a decision change", () => {
    const [a, b, c] = ["A", "B", "C"].map((n) => addPlace(rome, n));
    // Several swipes within the same second must keep their order (undo stack).
    expect(recordSwipe(t.db, trip, c.id, "like")).toBe(true);
    expect(recordSwipe(t.db, trip, a.id, "skip")).toBe(true);
    expect(recordSwipe(t.db, trip, b.id, "must")).toBe(true);
    expect(recordSwipe(t.db, trip, a.id, "like")).toBe(true);

    expect(getSwipeHistory(t.db, trip.id).map((s) => [s.place.name, s.decision])).toEqual([
      ["C", "like"],
      ["A", "like"],
      ["B", "must"],
    ]);
    expect(countShortlist(t.db, trip.id)).toBe(3);
  });

  it("rejects places from another city or that do not exist", () => {
    const louvre = addPlace(paris, "Louvre");
    expect(recordSwipe(t.db, trip, louvre.id, "like")).toBe(false);
    expect(recordSwipe(t.db, trip, crypto.randomUUID(), "like")).toBe(false);
    expect(getSwipeHistory(t.db, trip.id)).toEqual([]);
  });

  it("undo removes the decision", () => {
    const a = addPlace(rome, "A");
    recordSwipe(t.db, trip, a.id, "like");
    expect(removeSwipe(t.db, trip.id, a.id)).toBe(true);
    expect(removeSwipe(t.db, trip.id, a.id)).toBe(false);
    expect(countShortlist(t.db, trip.id)).toBe(0);
  });

  it("lists the shortlist with must-see first and without skips", () => {
    const [a, b, c] = ["A", "B", "C"].map((n) => addPlace(rome, n));
    recordSwipe(t.db, trip, a.id, "like");
    recordSwipe(t.db, trip, b.id, "skip");
    recordSwipe(t.db, trip, c.id, "must");
    expect(getShortlist(t.db, trip.id).map((s) => [s.place.name, s.decision])).toEqual([
      ["C", "must"],
      ["A", "like"],
    ]);
  });

  it("builds the deck from unswiped places ranked by interests and learned weights", () => {
    const art = addPlace(rome, "Art gallery", { category: "museum", tags: ["art"] });
    const park = addPlace(rome, "Park", { category: "park", tags: ["nature"], popularity: 5000 });
    const garden = addPlace(rome, "Garden", { category: "park", tags: ["nature"] });
    const church = addPlace(rome, "Church", { category: "religious-site", tags: ["religion"] });
    recordSwipe(t.db, trip, park.id, "skip");

    const pool = [art, park, garden, church];
    const { deck, history } = buildDeck(pool, getSwipeHistory(t.db, trip.id), ["art"]);
    expect(history.map((h) => h.place.id)).toEqual([park.id]);
    // Interest "art" first; the skipped park lowers the other park below the church.
    expect(deck.map((p) => p.name)).toEqual(["Art gallery", "Church", "Garden"]);
  });

  it("only exposes http(s) third-party links on cards", () => {
    const p = addPlace(rome, "Odd", {
      imageUrl: "javascript:alert(1)",
      imagePageUrl: "https://commons.wikimedia.org/wiki/File:Odd.jpg",
    });
    recordSwipe(t.db, trip, p.id, "like");
    const [entry] = getShortlist(t.db, trip.id);
    expect(entry.place.imageUrl).toBeNull();
    expect(entry.place.imagePageUrl).toBe("https://commons.wikimedia.org/wiki/File:Odd.jpg");
  });
});
