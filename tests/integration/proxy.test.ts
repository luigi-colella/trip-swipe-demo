import { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { config, NOT_FOUND_PATH, proxy } from "@/proxy";
import { db, sqlite } from "@/server/db/client";
import { upsertCity } from "@/server/places/cities";
import { createTrip, type Trip } from "@/server/trips/trips";
import { resetDatabase } from "../helpers/db";

/** src/proxy.ts against a throwaway database (the app's shared client is swapped for it). */
const t = vi.hoisted(() => ({ cleanup: () => {} }));
vi.mock("@/server/db/client", async () => {
  const { createTestDatabase } = await import("../helpers/db");
  const created = createTestDatabase();
  t.cleanup = created.cleanup;
  return { db: created.db, sqlite: created.sqlite, connection: created };
});

let trip: Trip;
beforeEach(() => {
  resetDatabase(sqlite);
  const city = upsertCity(db, {
    osmRef: "R41485",
    name: "Rome",
    state: "Lazio",
    country: "Italy",
    countryCode: "IT",
    lat: 41.8933,
    lon: 12.4829,
  });
  trip = createTrip(db, { cityId: city.id, days: 2, pace: "balanced", interests: [] });
});
afterAll(() => t.cleanup());

const run = (path: string, method = "GET") =>
  proxy(new NextRequest(`http://localhost${path}`, { method }));
const rewrittenTo = (res: Response) => res.headers.get("x-middleware-rewrite");

describe("proxy (unknown trips answer 404)", () => {
  it("lets the pages of a real trip through", () => {
    for (const path of [`/trip/${trip.id}`, `/trip/${trip.id}/swipe`, `/trip/${trip.id}/review`]) {
      const res = run(path, path.endsWith("review") ? "HEAD" : "GET");
      expect(rewrittenTo(res), path).toBeNull();
      expect(res.headers.get("x-middleware-next")).toBe("1");
    }
  });

  it("rewrites unknown and malformed trips to a path with no route (the 404 page)", () => {
    for (const path of [
      "/trip/00000000-0000-4000-8000-000000000000/swipe",
      "/trip/not-a-trip/itinerary",
      "/trip/00000000-0000-4000-8000-000000000000",
    ]) {
      expect(rewrittenTo(run(path)), path).toBe(`http://localhost${NOT_FOUND_PATH}`);
    }
  });

  it("leaves Server Action posts to the actions, which validate the trip themselves", () => {
    const res = run("/trip/00000000-0000-4000-8000-000000000000/swipe", "POST");
    expect(rewrittenTo(res)).toBeNull();
  });

  it("runs on the trip pages only", () => {
    expect(config.matcher).toEqual(["/trip/:id", "/trip/:id/:path*"]);
  });
});
