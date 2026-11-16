import type { ChatResult } from "@langchain/core/outputs";
import { FakeListChatModel } from "@langchain/core/utils/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SqliteLlmCache } from "@/server/ai/cache";
import type { PlannerOutput } from "@/server/ai/prompts";
import { llmCache, places } from "@/server/db/schema";
import { parseEnv } from "@/server/env-schema";
import type { PlannerDeps } from "@/server/itinerary/graph";
import {
  editItinerary,
  generateItinerary,
  getItineraryPlaces,
  getLatestItinerary,
  undoItinerary,
} from "@/server/itinerary/itineraries";
import { upsertCity, type City } from "@/server/places/cities";
import { createTrip, getTrip, recordSwipe, type TripWithCity } from "@/server/trips/trips";
import { createTestDatabase } from "../helpers/db";
import { romePlaces } from "../helpers/rome";

let t: ReturnType<typeof createTestDatabase>;
let rome: City;
let found: TripWithCity;
/** Alias order used by the planner: must-see first, then by popularity. */
let ids: Record<string, string>;

const env = parseEnv({ LLM_MODE: "fake" });
const deps = (extra: Partial<PlannerDeps> = {}): PlannerDeps => ({ env, ...extra });
const scripted =
  (...responses: string[]) =>
  () =>
    new FakeListChatModel({ responses });

/** A model whose provider is down (e.g. quota exhausted). */
class DownModel extends FakeListChatModel {
  calls = 0;
  async _generate(): Promise<ChatResult> {
    this.calls++;
    throw Object.assign(new Error("429 Rate limit exceeded"), { status: 429 });
  }
}

function seedShortlist(names: string[], must: string[] = []) {
  ids = {};
  for (const p of romePlaces(names, must)) {
    const row = t.db
      .insert(places)
      .values({
        id: crypto.randomUUID(),
        cityId: rome.id,
        wikiTitle: p.name,
        wikiUrl: `https://en.wikipedia.org/wiki/${encodeURIComponent(p.name)}`,
        name: p.name,
        category: p.category,
        pitch: "Pitch",
        lat: p.lat,
        lon: p.lon,
        visitMinutes: p.visitMinutes,
        popularity: p.popularity,
      })
      .returning()
      .get();
    ids[p.name] = row.id;
    recordSwipe(t.db, found.trip, row.id, p.must ? "must" : "like");
  }
}

const validOutput: PlannerOutput = {
  days: [
    {
      title: "Ancient Rome",
      stops: [
        { id: "P1", tip: "Book a timed ticket." },
        { id: "P2", tip: "" },
      ],
    },
    { title: "Baroque centre", stops: [{ id: "P3", tip: "" }] },
  ],
  excluded: [],
};

beforeEach(() => {
  t = createTestDatabase();
  rome = upsertCity(t.db, {
    osmRef: "R41485",
    name: "Rome",
    state: "Lazio",
    country: "Italy",
    countryCode: "IT",
    lat: 41.8933,
    lon: 12.4829,
  });
  const trip = createTrip(t.db, { cityId: rome.id, days: 2, pace: "relaxed", interests: [] });
  found = getTrip(t.db, trip.id)!;
  // Aliases: P1 Colosseum (must-see), then by popularity: P2 Trevi Fountain, P3 Roman Forum.
  seedShortlist(["Colosseum", "Roman Forum", "Trevi Fountain"], ["Colosseum"]);
});
afterEach(() => t.cleanup());

describe("itinerary generation (workflow B)", () => {
  it("plans the shortlist offline, saves version 1 and opens the itinerary step", async () => {
    const result = await generateItinerary(t.db, found, deps());
    expect(result).toMatchObject({ version: 1, attempts: 1, errors: [] });
    expect(result.data.source).toBe("ai");

    const latest = getLatestItinerary(t.db, found.trip.id)!;
    expect(latest).toMatchObject({ version: 1, versions: 1 });
    expect(latest.data.days).toHaveLength(2);
    const planned = latest.data.days.flatMap((d) => d.stops.map((s) => s.placeId));
    expect(planned.sort()).toEqual(Object.values(ids).sort());
    expect(getTrip(t.db, found.trip.id)!.trip.status).toBe("itinerary");

    const cards = getItineraryPlaces(t.db, found, latest.data);
    expect(cards).toHaveLength(3);
    expect(cards.find((c) => c.id === ids.Colosseum)).toMatchObject({ must: true, lat: 41.8902 });
  });

  it("repairs an invalid plan with the validator's errors", async () => {
    const broken: PlannerOutput = {
      days: [{ title: "All", stops: [{ id: "P1", tip: "" }] }],
      excluded: [{ id: "P1", reason: "Duplicate" }],
    };
    const result = await generateItinerary(
      t.db,
      found,
      deps({ fake: scripted("not json", JSON.stringify(broken), JSON.stringify(validOutput)) }),
    );
    expect(result.attempts).toBe(3);
    expect(result.data.source).toBe("ai");
    expect(result.data.days[0]).toEqual({
      title: "Ancient Rome",
      stops: [
        { placeId: ids.Colosseum, tip: "Book a timed ticket." },
        { placeId: ids["Trevi Fountain"], tip: null },
      ],
    });
  });

  it("falls back to the deterministic plan after the last failed repair", async () => {
    const result = await generateItinerary(t.db, found, deps({ fake: scripted("{}") }));
    expect(result.attempts).toBe(3);
    expect(result.data.source).toBe("fallback");
    expect(result.errors.length).toBeGreaterThan(0);
    expect(getLatestItinerary(t.db, found.trip.id)?.data.source).toBe("fallback");
  });

  it("falls back immediately when the provider is unavailable", async () => {
    const model = new DownModel({ responses: [] });
    const result = await generateItinerary(t.db, found, deps({ fake: () => model }));
    expect(model.calls).toBe(1);
    expect(result).toMatchObject({ attempts: 1, version: 1 });
    expect(result.data.source).toBe("fallback");
  });

  it("caches the first plan but asks the model again for an alternative", async () => {
    const cached = deps({ llmCache: new SqliteLlmCache(t.db) });
    await generateItinerary(t.db, found, cached);
    await generateItinerary(t.db, found, cached);
    expect(t.db.select().from(llmCache).all()).toHaveLength(1);

    const result = await generateItinerary(t.db, found, cached, { regenerate: true });
    expect(result.version).toBe(3);
    expect(t.db.select().from(llmCache).all()).toHaveLength(1);
  });

  it("refuses an empty shortlist", async () => {
    const trip = createTrip(t.db, { cityId: rome.id, days: 1, pace: "relaxed", interests: [] });
    await expect(generateItinerary(t.db, getTrip(t.db, trip.id)!, deps())).rejects.toThrow(
      "Like at least one place first.",
    );
  });
});

describe("itinerary versions", () => {
  it("saves quick actions as new versions and undoes them one at a time", async () => {
    await generateItinerary(t.db, found, deps({ fake: scripted(JSON.stringify(validOutput)) }));
    const tripId = found.trip.id;

    expect(
      editItinerary(t.db, tripId, { type: "change-day", placeId: ids.Colosseum, day: 1 }),
    ).toBe(true);
    expect(editItinerary(t.db, tripId, { type: "remove", placeId: ids["Trevi Fountain"] })).toBe(
      true,
    );
    let latest = getLatestItinerary(t.db, tripId)!;
    expect(latest).toMatchObject({ version: 3, versions: 3 });
    expect(latest.data.days.map((d) => d.stops.map((s) => s.placeId))).toEqual([
      [],
      [ids["Roman Forum"], ids.Colosseum],
    ]);
    expect(latest.data.excluded.map((x) => x.placeId)).toEqual([ids["Trevi Fountain"]]);

    // Edits that do not apply leave no version behind.
    expect(editItinerary(t.db, tripId, { type: "remove", placeId: ids["Trevi Fountain"] })).toBe(
      false,
    );
    expect(
      editItinerary(t.db, tripId, { type: "move", placeId: ids.Colosseum, direction: "down" }),
    ).toBe(false);
    expect(getLatestItinerary(t.db, tripId)?.version).toBe(3);

    expect(undoItinerary(t.db, tripId)).toBe(true);
    latest = getLatestItinerary(t.db, tripId)!;
    expect(latest).toMatchObject({ version: 2, versions: 2 });
    expect(latest.data.excluded).toEqual([]);
    expect(undoItinerary(t.db, tripId)).toBe(true);
    // The first version is never undone.
    expect(undoItinerary(t.db, tripId)).toBe(false);
    expect(getLatestItinerary(t.db, tripId)?.version).toBe(1);
  });

  it("starts the version count again after undo", async () => {
    await generateItinerary(t.db, found, deps());
    editItinerary(t.db, found.trip.id, { type: "remove", placeId: ids.Colosseum });
    undoItinerary(t.db, found.trip.id);
    editItinerary(t.db, found.trip.id, { type: "remove", placeId: ids["Roman Forum"] });
    expect(getLatestItinerary(t.db, found.trip.id)).toMatchObject({ version: 2, versions: 2 });
  });
});

describe("itinerary store edge cases", () => {
  it("has no latest version, edit or undo before the first plan", () => {
    expect(getLatestItinerary(t.db, found.trip.id)).toBeUndefined();
    expect(editItinerary(t.db, found.trip.id, { type: "remove", placeId: ids.Colosseum })).toBe(
      false,
    );
    expect(undoItinerary(t.db, found.trip.id)).toBe(false);
  });

  it("loads scheduled and excluded places, never places from another city", async () => {
    const paris = upsertCity(t.db, {
      osmRef: "R7444",
      name: "Paris",
      state: null,
      country: "France",
      countryCode: "FR",
      lat: 48.85,
      lon: 2.35,
    });
    const louvre = t.db
      .insert(places)
      .values({
        id: crypto.randomUUID(),
        cityId: paris.id,
        wikiTitle: "Louvre",
        wikiUrl: "https://en.wikipedia.org/wiki/Louvre",
        name: "Louvre",
        category: "museum",
        pitch: "Pitch",
        lat: 48.86,
        lon: 2.34,
        visitMinutes: 180,
      })
      .returning()
      .get();
    const cards = getItineraryPlaces(t.db, found, {
      days: [{ title: "A", stops: [{ placeId: ids.Colosseum, tip: null }] }],
      excluded: [
        { placeId: ids["Roman Forum"], reason: "No time" },
        { placeId: louvre.id, reason: "Injected" },
      ],
      source: "ai",
    });
    expect(cards.map((c) => c.name).sort()).toEqual(["Colosseum", "Roman Forum"]);
    expect(cards.find((c) => c.name === "Roman Forum")?.must).toBe(false);
    expect(getItineraryPlaces(t.db, found, { days: [], excluded: [], source: "ai" })).toEqual([]);
  });

  it("shares one planning run between concurrent requests for the same trip", async () => {
    const calls: number[] = [];
    const fake = () => {
      calls.push(1);
      return new FakeListChatModel({ responses: [JSON.stringify(validOutput)] });
    };
    const [a, b] = await Promise.all([
      generateItinerary(t.db, found, deps({ fake })),
      generateItinerary(t.db, found, deps({ fake })),
    ]);
    expect(a).toBe(b);
    expect(calls).toHaveLength(1);
    expect(getLatestItinerary(t.db, found.trip.id)?.versions).toBe(1);
    // Once settled, a new request plans again.
    await generateItinerary(t.db, found, deps({ fake }));
    expect(getLatestItinerary(t.db, found.trip.id)?.versions).toBe(2);
  });

  it("leaves the trip status unchanged when planning fails", async () => {
    const trip = createTrip(t.db, { cityId: rome.id, days: 1, pace: "relaxed", interests: [] });
    await expect(generateItinerary(t.db, getTrip(t.db, trip.id)!, deps())).rejects.toThrow();
    expect(getTrip(t.db, trip.id)?.trip.status).toBe("swiping");
  });

  it("plans only liked and must-see places, never skipped ones", async () => {
    const skipped = t.db
      .insert(places)
      .values({
        id: crypto.randomUUID(),
        cityId: rome.id,
        wikiTitle: "Skipped",
        wikiUrl: "https://en.wikipedia.org/wiki/Skipped",
        name: "Skipped",
        category: "landmark",
        pitch: "Pitch",
        lat: 41.9,
        lon: 12.48,
        visitMinutes: 30,
      })
      .returning()
      .get();
    recordSwipe(t.db, found.trip, skipped.id, "skip");
    const { data } = await generateItinerary(t.db, found, deps());
    const all = [...data.days.flatMap((d) => d.stops), ...data.excluded].map((x) => x.placeId);
    expect(all).not.toContain(skipped.id);
    expect(all).toHaveLength(3);
  });
});
