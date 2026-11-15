import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cities, places, swipes, trips } from "@/server/db/schema";
import { createTestDatabase } from "../helpers/db";

let t: ReturnType<typeof createTestDatabase>;
beforeEach(() => {
  t = createTestDatabase();
});
afterEach(() => t.cleanup());

function seedRome() {
  t.db
    .insert(cities)
    .values({ id: "c1", slug: "rome-it", name: "Rome", country: "Italy", lat: 41.9, lon: 12.5 })
    .run();
  t.db
    .insert(places)
    .values({
      id: "p1",
      cityId: "c1",
      wikiTitle: "Colosseum",
      wikiUrl: "https://en.wikipedia.org/wiki/Colosseum",
      name: "Colosseum",
      category: "history",
      tags: ["history", "architecture"],
      pitch: "Ancient amphitheatre.",
      lat: 41.89,
      lon: 12.49,
      visitMinutes: 90,
    })
    .run();
}

describe("SQLite + Drizzle", () => {
  it("runs in WAL mode with foreign keys enforced", () => {
    expect(t.sqlite.pragma("journal_mode", { simple: true })).toBe("wal");
    expect(t.sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
  });

  it("round-trips JSON columns and defaults", () => {
    seedRome();
    const place = t.db.select().from(places).where(eq(places.id, "p1")).get();
    expect(place?.tags).toEqual(["history", "architecture"]);
    expect(place?.fetchedAt).toBeInstanceOf(Date);
  });

  it("upserts places on (city, wiki title) instead of duplicating", () => {
    seedRome();
    t.db
      .insert(places)
      .values({
        id: "p2",
        cityId: "c1",
        wikiTitle: "Colosseum",
        wikiUrl: "https://en.wikipedia.org/wiki/Colosseum",
        name: "Colosseum",
        category: "history",
        pitch: "Updated pitch.",
        lat: 41.89,
        lon: 12.49,
        visitMinutes: 120,
      })
      .onConflictDoUpdate({
        target: [places.cityId, places.wikiTitle],
        set: { pitch: "Updated pitch.", visitMinutes: 120 },
      })
      .run();

    const all = t.db.select().from(places).all();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ id: "p1", pitch: "Updated pitch.", visitMinutes: 120 });
  });

  it("cascades trip deletion to swipes", () => {
    seedRome();
    t.db.insert(trips).values({ id: "t1", cityId: "c1", days: 2, pace: "balanced" }).run();
    t.db.insert(swipes).values({ tripId: "t1", placeId: "p1", decision: "like" }).run();

    t.db.delete(trips).where(eq(trips.id, "t1")).run();
    const left = t.db
      .select()
      .from(swipes)
      .where(and(eq(swipes.tripId, "t1"), eq(swipes.placeId, "p1")))
      .all();
    expect(left).toHaveLength(0);
  });

  it("rejects swipes for unknown places", () => {
    seedRome();
    t.db.insert(trips).values({ id: "t1", cityId: "c1", days: 2, pace: "balanced" }).run();
    expect(() =>
      t.db.insert(swipes).values({ tripId: "t1", placeId: "missing", decision: "like" }).run(),
    ).toThrow(/FOREIGN KEY/);
  });
});
