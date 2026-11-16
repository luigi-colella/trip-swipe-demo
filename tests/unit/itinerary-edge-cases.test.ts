import { describe, expect, it } from "vitest";
import { estimateLeg, formatDistance, MAX_WALK_KM, ROUTE_FACTOR } from "@/lib/geo";
import {
  formatClock,
  ItineraryDataSchema,
  ItineraryEditSchema,
  paceMinutes,
  scheduleDay,
  scheduleItineraryDay,
  type ScheduleStop,
} from "@/lib/itinerary";
import { googleMapsDayUrls } from "@/lib/maps-url";

const origin = { lat: 41.9, lon: 12.5 };
/** A point `km` of straight-line distance north of the origin. */
const north = (km: number) => ({ lat: origin.lat + km / 111.195, lon: origin.lon });
const here = (placeId: string, visitMinutes: number): ScheduleStop => ({
  placeId,
  visitMinutes,
  ...origin,
});
const uuid = "00000000-0000-4000-8000-000000000001";

describe("travel leg boundaries", () => {
  it("walks exactly up to the 2 km route length and takes transit just beyond", () => {
    const limit = MAX_WALK_KM / ROUTE_FACTOR;
    expect(estimateLeg(origin, north(limit - 0.001)).mode).toBe("walk");
    expect(estimateLeg(origin, north(limit + 0.001)).mode).toBe("transit");
  });

  it("rounds every non-zero leg up to a 5-minute step", () => {
    // 100 m of route at 4.5 km/h is 1.3 min → 5 min.
    expect(estimateLeg(origin, north(0.1 / ROUTE_FACTOR)).minutes).toBe(5);
    // Under 50 m of straight line the places are next door.
    expect(estimateLeg(origin, north(0.04)).minutes).toBe(0);
  });

  it("formats short distances with a 10 m floor", () => {
    expect(formatDistance(0.001)).toBe("10 m");
    expect(formatDistance(0.999)).toBe("1000 m");
    expect(formatDistance(1)).toBe("1.0 km");
  });
});

describe("schedule edge cases", () => {
  it("starts lunch exactly at 12:30", () => {
    const day = scheduleDay([here("a", 210), here("b", 30)], 600);
    expect(day.items.map((i) => [i.kind, formatClock(i.start)])).toEqual([
      ["visit", "09:00"],
      ["lunch", "12:30"],
      ["visit", "13:30"],
    ]);
  });

  it("has no lunch for a single stop or a day that ends in the morning", () => {
    expect(scheduleDay([here("a", 300)], 600).items.map((i) => i.kind)).toEqual(["visit"]);
    const morning = scheduleDay([here("a", 60), here("b", 60)], 600);
    expect(morning.items.map((i) => i.kind)).toEqual(["visit", "visit"]);
    expect(formatClock(morning.end)).toBe("11:00");
  });

  it("skips stops whose place no longer exists", () => {
    const places = new Map([["a", { ...origin, visitMinutes: 60 }]]);
    const day = scheduleItineraryDay(
      {
        title: "T",
        stops: [
          { placeId: "a", tip: null },
          { placeId: "gone", tip: null },
        ],
      },
      places,
      paceMinutes("intense"),
    );
    expect(day.items).toEqual([{ kind: "visit", placeId: "a", number: 1, start: 540, end: 600 }]);
  });

  it("formats clock times past midnight and pads single digits", () => {
    expect(formatClock(0)).toBe("00:00");
    expect(formatClock(25 * 60 + 5)).toBe("01:05");
  });

  it("maps paces to their active minutes", () => {
    expect([paceMinutes("relaxed"), paceMinutes("balanced"), paceMinutes("intense")]).toEqual([
      360, 480, 600,
    ]);
  });
});

describe("itinerary schemas", () => {
  it("accepts the three quick actions and rejects malformed ones", () => {
    expect(ItineraryEditSchema.safeParse({ type: "remove", placeId: uuid }).success).toBe(true);
    expect(
      ItineraryEditSchema.safeParse({ type: "move", placeId: uuid, direction: "up" }).success,
    ).toBe(true);
    expect(
      ItineraryEditSchema.safeParse({ type: "change-day", placeId: uuid, day: 6 }).success,
    ).toBe(true);
    for (const bad of [
      { type: "remove", placeId: "P1" },
      { type: "move", placeId: uuid, direction: "left" },
      { type: "change-day", placeId: uuid, day: -1 },
      { type: "change-day", placeId: uuid, day: 7 },
      { type: "change-day", placeId: uuid, day: 1.5 },
      { type: "rename", placeId: uuid },
      null,
    ]) {
      expect(ItineraryEditSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it("rejects stored itineraries with an unknown shape", () => {
    expect(ItineraryDataSchema.safeParse({ days: [], excluded: [], source: "ai" }).success).toBe(
      true,
    );
    expect(ItineraryDataSchema.safeParse({ days: [], excluded: [], source: "llm" }).success).toBe(
      false,
    );
    expect(ItineraryDataSchema.safeParse({ days: [{ title: 1 }] }).success).toBe(false);
  });
});

describe("Google Maps link splitting", () => {
  const stops = (n: number) => Array.from({ length: n }, (_, i) => north(i));
  it("needs a third link from the 22nd stop", () => {
    expect(googleMapsDayUrls(stops(21))).toHaveLength(2);
    const urls = googleMapsDayUrls(stops(22));
    expect(urls).toHaveLength(3);
    // The last link only has the final leg: origin = stop 21, destination = stop 22.
    const last = new URL(urls[2]).searchParams;
    expect(last.has("waypoints")).toBe(false);
  });
});
