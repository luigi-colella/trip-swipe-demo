import { http, HttpResponse } from "msw";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, sqlite } from "@/server/db/client";
import { places } from "@/server/db/schema";
import {
  editItineraryAction,
  generateItineraryAction,
  regenerateItineraryAction,
  undoItineraryAction,
} from "@/server/actions/itinerary";
import {
  createTripAction,
  loadMorePlacesAction,
  recordSwipeAction,
  startReviewAction,
  undoSwipeAction,
  updateShortlistAction,
} from "@/server/actions/trips";
import { plannerDeps } from "@/server/itinerary/deps";
import { getLatestItinerary } from "@/server/itinerary/itineraries";
import { upsertCity, type City } from "@/server/places/cities";
import { createTrip, getSwipeHistory, getTrip, recordSwipe, type Trip } from "@/server/trips/trips";
import { resetDatabase } from "../helpers/db";
import { mockWikimedia, server } from "../helpers/msw";

/**
 * Server Actions against a throwaway database (the app's shared client is swapped for it) with
 * Next.js navigation stubbed: redirect() throws like the real one, refresh() is recorded.
 */
const t = vi.hoisted(() => ({ cleanup: () => {} }));
vi.mock("@/server/db/client", async () => {
  const { createTestDatabase } = await import("../helpers/db");
  const created = createTestDatabase();
  t.cleanup = created.cleanup;
  return { db: created.db, sqlite: created.sqlite, connection: created };
});
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
}));
const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ refresh }));

const ROME = {
  osmRef: "R41485",
  name: "Rome",
  state: "Lazio",
  country: "Italy",
  countryCode: "IT",
  lat: 41.8933,
  lon: 12.4829,
};

let rome: City;
let trip: Trip;

function addPlace(name: string, cityId = rome.id) {
  return db
    .insert(places)
    .values({
      id: crypto.randomUUID(),
      cityId,
      wikiTitle: name,
      wikiUrl: `https://en.wikipedia.org/wiki/${encodeURIComponent(name)}`,
      name,
      category: "landmark",
      pitch: "Pitch",
      lat: 41.89,
      lon: 12.49,
      visitMinutes: 60,
    })
    .returning()
    .get();
}

function form(fields: Record<string, string | string[]>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    for (const v of [value].flat()) data.append(key, v);
  }
  return data;
}

const missingId = "00000000-0000-4000-8000-000000000000";

beforeEach(() => {
  resetDatabase(sqlite);
  refresh.mockClear();
  rome = upsertCity(db, ROME);
  trip = createTrip(db, { cityId: rome.id, days: 1, pace: "relaxed", interests: [] });
});
afterAll(() => t.cleanup());

describe("createTripAction (F1)", () => {
  const valid = { cityQuery: "rome actions", osmRef: "R41485", days: "2", pace: "balanced" };

  it("reports the first validation error", async () => {
    expect(await createTripAction(undefined, form({ ...valid, osmRef: "" }))).toEqual({
      error: "Pick a city from the suggestions.",
    });
  });

  it("creates the trip and opens its deck", async () => {
    mockWikimedia({});
    await expect(
      createTripAction(undefined, form({ ...valid, interests: ["art", "food"] })),
    ).rejects.toThrow(/^REDIRECT \/trip\/[0-9a-f-]{36}\/swipe$/);
    const created = sqlite
      .prepare("SELECT days, pace, interests FROM trips WHERE id != ?")
      .get(trip.id);
    expect(created).toEqual({ days: 2, pace: "balanced", interests: '["art","food"]' });
  });

  it("refuses a city that is not among the suggestions", async () => {
    mockWikimedia({});
    expect(
      await createTripAction(undefined, form({ ...valid, cityQuery: "rome other", osmRef: "R1" })),
    ).toEqual({ error: "Pick a city from the suggestions." });
  });

  it("explains when city search is down", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    server.use(http.get("https://photon.komoot.io/api/", () => HttpResponse.error()));
    expect(await createTripAction(undefined, form({ ...valid, cityQuery: "rome down" }))).toEqual({
      error: "City search is unavailable, please retry.",
    });
  });
});

describe("swipe actions (F3)", () => {
  it("records and undoes a swipe", async () => {
    const p = addPlace("Colosseum");
    expect(await recordSwipeAction(trip.id, p.id, "like")).toEqual({ ok: true });
    expect(getSwipeHistory(db, trip.id)).toHaveLength(1);
    expect(await undoSwipeAction(trip.id, p.id)).toEqual({ ok: true });
    expect(getSwipeHistory(db, trip.id)).toHaveLength(0);
  });

  it("rejects invalid input, unknown trips and places from elsewhere", async () => {
    const p = addPlace("Colosseum");
    const paris = upsertCity(db, { ...ROME, osmRef: "R2", name: "Paris", state: null });
    const louvre = addPlace("Louvre", paris.id);
    expect(await recordSwipeAction(trip.id, p.id, "love")).toEqual({
      ok: false,
      error: "Invalid swipe.",
    });
    expect(await recordSwipeAction(missingId, p.id, "like")).toEqual({
      ok: false,
      error: "Trip not found.",
    });
    expect(await recordSwipeAction(trip.id, louvre.id, "like")).toEqual({
      ok: false,
      error: "This place is not part of the trip.",
    });
    expect(await undoSwipeAction(trip.id, "nope")).toEqual({ ok: false, error: "Invalid undo." });
    expect(await undoSwipeAction(missingId, p.id)).toEqual({
      ok: false,
      error: "Trip not found.",
    });
  });
});

describe("loadMorePlacesAction (F3)", () => {
  it("returns new cards for the deck", async () => {
    mockWikimedia({ Colosseum: { lat: 41.89, lon: 12.49 } });
    const r = await loadMorePlacesAction(trip.id);
    expect(r).toMatchObject({ ok: true, data: [{ name: "Colosseum" }] });
  });

  it("fails cleanly on bad input, unknown trips and discovery errors", async () => {
    expect(await loadMorePlacesAction("x")).toEqual({ ok: false, error: "Invalid trip." });
    expect(await loadMorePlacesAction(missingId)).toEqual({
      ok: false,
      error: "Trip not found.",
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockWikimedia({}, { failWikipedia: true });
    expect(await loadMorePlacesAction(trip.id)).toEqual({
      ok: false,
      error: "Could not find more places right now, please retry.",
    });
  });
});

describe("review actions (F10)", () => {
  it("needs a liked place, then opens the review step", async () => {
    expect(await startReviewAction("x")).toEqual({ ok: false, error: "Invalid trip." });
    expect(await startReviewAction(missingId)).toEqual({ ok: false, error: "Trip not found." });
    expect(await startReviewAction(trip.id)).toEqual({
      ok: false,
      error: "Like at least one place first.",
    });
    recordSwipe(db, trip, addPlace("Colosseum").id, "like");
    await expect(startReviewAction(trip.id)).rejects.toThrow(`REDIRECT /trip/${trip.id}/review`);
    expect(getTrip(db, trip.id)?.trip.status).toBe("review");
  });

  it("never moves a trip back from the itinerary step", async () => {
    recordSwipe(db, trip, addPlace("Colosseum").id, "like");
    sqlite.prepare("UPDATE trips SET status = 'itinerary'").run();
    await expect(startReviewAction(trip.id)).rejects.toThrow("REDIRECT");
    expect(getTrip(db, trip.id)?.trip.status).toBe("itinerary");
  });

  it("refreshes the page only when the shortlist changed", async () => {
    const p = addPlace("Colosseum");
    expect(await updateShortlistAction(trip.id, p.id, "must")).toEqual({ ok: true });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(await updateShortlistAction(trip.id, p.id, "maybe")).toMatchObject({ ok: false });
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

describe("itinerary actions (F4)", () => {
  async function planned() {
    const a = addPlace("Colosseum");
    const b = addPlace("Pantheon");
    recordSwipe(db, trip, a.id, "must");
    recordSwipe(db, trip, b.id, "like");
    await expect(generateItineraryAction(trip.id)).rejects.toThrow(
      `REDIRECT /trip/${trip.id}/itinerary`,
    );
    return { a, b };
  }

  afterEach(() => {
    delete plannerDeps.fake;
  });

  it("plans the shortlist and opens the itinerary", async () => {
    await planned();
    expect(getLatestItinerary(db, trip.id)?.version).toBe(1);
    expect(getTrip(db, trip.id)?.trip.status).toBe("itinerary");
  });

  it("rejects unknown trips and empty shortlists", async () => {
    for (const action of [
      generateItineraryAction,
      regenerateItineraryAction,
      undoItineraryAction,
    ] as const) {
      expect(await action("not-a-uuid")).toEqual({ ok: false, error: "Trip not found." });
      expect(await action(missingId)).toEqual({ ok: false, error: "Trip not found." });
    }
    expect(await editItineraryAction(missingId, {})).toEqual({
      ok: false,
      error: "Trip not found.",
    });
    expect(await generateItineraryAction(trip.id)).toEqual({
      ok: false,
      error: "Like at least one place first.",
    });
    expect(await regenerateItineraryAction(trip.id)).toEqual({
      ok: false,
      error: "Like at least one place first.",
    });
  });

  it("reports unexpected planning failures without details", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    recordSwipe(db, trip, addPlace("Colosseum").id, "like");
    plannerDeps.fake = () => {
      throw new Error("database is locked");
    };
    const error = { ok: false, error: "Could not plan the trip right now, please retry." };
    expect(await generateItineraryAction(trip.id)).toEqual(error);
    expect(await regenerateItineraryAction(trip.id)).toEqual(error);
  });

  it("regenerates, edits and undoes, refreshing the page each time", async () => {
    const { a } = await planned();
    expect(await regenerateItineraryAction(trip.id)).toEqual({
      ok: true,
      data: { source: "ai" },
    });
    expect(await editItineraryAction(trip.id, { type: "remove", placeId: a.id })).toEqual({
      ok: true,
    });
    expect(await undoItineraryAction(trip.id)).toEqual({ ok: true });
    expect(refresh).toHaveBeenCalledTimes(3);
    expect(getLatestItinerary(db, trip.id)?.version).toBe(2);
  });

  it("rejects malformed and stale edits, and undo with nothing to undo", async () => {
    const { a } = await planned();
    expect(await editItineraryAction(trip.id, { type: "remove", placeId: "P1" })).toEqual({
      ok: false,
      error: "Invalid change.",
    });
    expect(
      await editItineraryAction(trip.id, { type: "move", placeId: missingId, direction: "up" }),
    ).toEqual({ ok: false, error: "This change no longer applies." });
    expect(await undoItineraryAction(trip.id)).toEqual({ ok: false, error: "Nothing to undo." });
    expect(refresh).not.toHaveBeenCalled();
    expect(getLatestItinerary(db, trip.id)?.data.days[0].stops.map((s) => s.placeId)).toContain(
      a.id,
    );
  });
});
