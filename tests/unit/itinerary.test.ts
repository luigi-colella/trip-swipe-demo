import { describe, expect, it } from "vitest";
import { estimateLeg, formatDistance } from "@/lib/geo";
import {
  applyItineraryEdit,
  formatClock,
  paceMinutes,
  REMOVED_BY_USER_REASON,
  scheduleDay,
  type ItineraryData,
  type ScheduleStop,
} from "@/lib/itinerary";
import { googleMapsDayUrls, MAX_WAYPOINTS } from "@/lib/maps-url";

const colosseum = { lat: 41.8902, lon: 12.4922 };
const forum = { lat: 41.8925, lon: 12.4853 };
const ostia = { lat: 41.7556, lon: 12.2919 };

/** Stops at the same spot: no travel, so times depend on visits and lunch only. */
const here = (placeId: string, visitMinutes: number): ScheduleStop => ({
  placeId,
  visitMinutes,
  ...colosseum,
});
const clock = (items: ReturnType<typeof scheduleDay>["items"]) =>
  items.map(
    (i) =>
      `${i.kind === "visit" ? i.placeId : i.kind} ${formatClock(i.start)}-${formatClock(i.end)}`,
  );

describe("travel legs", () => {
  it("walks short routes and takes transit beyond 2 km, rounded up to 5 minutes", () => {
    expect(estimateLeg(colosseum, forum)).toMatchObject({ mode: "walk", minutes: 15 });
    const far = estimateLeg(colosseum, ostia);
    expect(far.mode).toBe("transit");
    // ~25 km × 1.3 at 20 km/h + 10 min.
    expect(far.minutes).toBeGreaterThanOrEqual(100);
    expect(far.minutes).toBeLessThanOrEqual(120);
    expect(far.minutes % 5).toBe(0);
    expect(estimateLeg(colosseum, colosseum)).toEqual({ mode: "walk", km: 0, minutes: 0 });
  });

  it("formats distances", () => {
    expect(formatDistance(0.814)).toBe("810 m");
    expect(formatDistance(3.42)).toBe("3.4 km");
  });
});

describe("day schedule", () => {
  it("starts at 09:00 and has lunch after the stop in progress at 12:30", () => {
    const day = scheduleDay([here("a", 120), here("b", 90), here("c", 60)], paceMinutes("relaxed"));
    expect(clock(day.items)).toEqual([
      "a 09:00-11:00",
      "b 11:00-12:30",
      "lunch 12:30-13:30",
      "c 13:30-14:30",
    ]);
    expect(day.activeMinutes).toBe(270);
    expect(day.overMinutes).toBe(0);
  });

  it("takes an early lunch rather than starting a stop that would push it past 14:00", () => {
    const day = scheduleDay([here("a", 165), here("b", 150)], 600);
    expect(clock(day.items)).toEqual(["a 09:00-11:45", "lunch 11:45-12:45", "b 12:45-15:15"]);
  });

  it("has lunch after a long morning visit when it is too early to stop before it", () => {
    const day = scheduleDay([here("a", 60), here("b", 300), here("c", 30)], 600);
    expect(clock(day.items)).toEqual([
      "a 09:00-10:00",
      "b 10:00-15:00",
      "lunch 15:00-16:00",
      "c 16:00-16:30",
    ]);
  });

  it("adds legs between stops and counts them as active time, not lunch", () => {
    const day = scheduleDay(
      [
        { placeId: "colosseum", visitMinutes: 120, ...colosseum },
        { placeId: "forum", visitMinutes: 90, ...forum },
        { placeId: "ostia", visitMinutes: 120, ...ostia },
      ],
      paceMinutes("relaxed"),
    );
    expect(day.items.map((i) => i.kind)).toEqual([
      "visit",
      "leg",
      "visit",
      "lunch",
      "leg",
      "visit",
    ]);
    const legs = day.items.filter((i) => i.kind === "leg");
    expect(day.activeMinutes).toBe(330 + legs.reduce((s, l) => s + (l.end - l.start), 0));
    expect(day.overMinutes).toBe(day.activeMinutes - 360);
    expect(day.items.filter((i) => i.kind === "visit").map((i) => i.number)).toEqual([1, 2, 3]);
  });

  it("returns an empty day for no stops", () => {
    expect(scheduleDay([], 360)).toMatchObject({ items: [], activeMinutes: 0, overMinutes: 0 });
  });
});

describe("quick actions", () => {
  const [a, b, c, d] = [1, 2, 3, 4].map((n) => `00000000-0000-4000-8000-00000000000${n}`);
  const data: ItineraryData = {
    days: [
      { title: "One", stops: [a, b, c].map((placeId) => ({ placeId, tip: null })) },
      { title: "Two", stops: [{ placeId: d, tip: "Go early." }] },
    ],
    excluded: [],
    source: "ai",
  };
  const ids = (x: ItineraryData | null) => x?.days.map((day) => day.stops.map((s) => s.placeId));

  it("removes a stop into the excluded list", () => {
    const next = applyItineraryEdit(data, { type: "remove", placeId: b });
    expect(ids(next)).toEqual([[a, c], [d]]);
    expect(next?.excluded).toEqual([{ placeId: b, reason: REMOVED_BY_USER_REASON }]);
    // The input is never mutated.
    expect(ids(data)).toEqual([[a, b, c], [d]]);
  });

  it("moves a stop within its day", () => {
    expect(ids(applyItineraryEdit(data, { type: "move", placeId: b, direction: "up" }))).toEqual([
      [b, a, c],
      [d],
    ]);
    expect(ids(applyItineraryEdit(data, { type: "move", placeId: b, direction: "down" }))).toEqual([
      [a, c, b],
      [d],
    ]);
    expect(applyItineraryEdit(data, { type: "move", placeId: a, direction: "up" })).toBeNull();
    expect(applyItineraryEdit(data, { type: "move", placeId: d, direction: "down" })).toBeNull();
  });

  it("moves a stop to the end of another day, keeping its tip", () => {
    const next = applyItineraryEdit(data, { type: "change-day", placeId: d, day: 0 });
    expect(ids(next)).toEqual([[a, b, c, d], []]);
    expect(next?.days[0].stops.at(-1)?.tip).toBe("Go early.");
    expect(applyItineraryEdit(data, { type: "change-day", placeId: d, day: 1 })).toBeNull();
    expect(applyItineraryEdit(data, { type: "change-day", placeId: d, day: 5 })).toBeNull();
  });

  it("ignores places that are not scheduled", () => {
    const unknown = "00000000-0000-4000-8000-000000000009";
    expect(applyItineraryEdit(data, { type: "remove", placeId: unknown })).toBeNull();
  });
});

describe("Google Maps links", () => {
  const stops = Array.from({ length: 12 }, (_, i) => ({ lat: 41.9 + i / 1000, lon: 12.5 }));
  const params = (url: string) => new URL(url).searchParams;

  it("builds walking directions through the day's stops", () => {
    const [url] = googleMapsDayUrls(stops.slice(0, 3));
    expect(url.startsWith("https://www.google.com/maps/dir/?api=1")).toBe(true);
    const p = params(url);
    expect(p.get("origin")).toBe("41.900000,12.500000");
    expect(p.get("waypoints")).toBe("41.901000,12.500000");
    expect(p.get("destination")).toBe("41.902000,12.500000");
    expect(p.get("travelmode")).toBe("walking");
  });

  it("gives directions from the current location for a single stop", () => {
    const [url] = googleMapsDayUrls(stops.slice(0, 1));
    expect(params(url).has("origin")).toBe(false);
    expect(params(url).get("destination")).toBe("41.900000,12.500000");
    expect(googleMapsDayUrls([])).toEqual([]);
  });

  it("splits long days into chained links within the waypoint limit", () => {
    expect(googleMapsDayUrls(stops.slice(0, 11))).toHaveLength(1);
    const urls = googleMapsDayUrls(stops);
    expect(urls).toHaveLength(2);
    expect(params(urls[0]).get("waypoints")!.split("|")).toHaveLength(MAX_WAYPOINTS);
    // The second link starts where the first one ends.
    expect(params(urls[1]).get("origin")).toBe(params(urls[0]).get("destination"));
    expect(params(urls[1]).get("destination")).toBe("41.911000,12.500000");
  });
});
