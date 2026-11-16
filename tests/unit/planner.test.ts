import { describe, expect, it } from "vitest";
import { paceMinutes, scheduleDay, type ItineraryData } from "@/lib/itinerary";
import type { PlannerOutput } from "@/server/ai/prompts";
import { clusterPlaces, orderRoute, selectPlaces } from "@/server/itinerary/cluster";
import { buildDraftItinerary, type PlannerPlace } from "@/server/itinerary/fallback";
import {
  cleanDayTitle,
  fixDetours,
  validatePlan,
  type PlanContext,
} from "@/server/itinerary/validate";
import { romePlaces } from "../helpers/rome";

const groupOf = (groups: PlannerPlace[][], id: string) =>
  groups.findIndex((g) => g.some((p) => p.id === id));
const scheduled = (data: ItineraryData) => data.days.flatMap((d) => d.stops.map((s) => s.placeId));

describe("place selection", () => {
  it("keeps must-see places even over budget and fills the rest by popularity", () => {
    const places = romePlaces(
      ["Colosseum", "Vatican Museums", "Pantheon", "Ostia Antica"],
      ["Ostia Antica"],
    );
    const { kept, excluded } = selectPlaces(places, 380);
    // Ostia (must, 180+15) + Colosseum (120+15) = 330; the Vatican (+195) no longer fits, the Pantheon (+45) does.
    expect(kept.map((p) => p.name)).toEqual(["Ostia Antica", "Colosseum", "Pantheon"]);
    expect(excluded.map((p) => p.name)).toEqual(["Vatican Museums"]);
  });
});

describe("clustering", () => {
  it("groups nearby places into the same day", () => {
    const groups = clusterPlaces(
      romePlaces(["Colosseum", "Roman Forum", "Vatican Museums", "St. Peter's Basilica"]),
      2,
    );
    expect(groups).toHaveLength(2);
    expect(groupOf(groups, "colosseum")).toBe(groupOf(groups, "roman-forum"));
    expect(groupOf(groups, "vatican-museums")).toBe(groupOf(groups, "st-peter-s-basilica"));
    expect(groupOf(groups, "colosseum")).not.toBe(groupOf(groups, "vatican-museums"));
  });

  it("never returns more groups than places", () => {
    expect(clusterPlaces(romePlaces(["Colosseum"]), 3)).toHaveLength(1);
    expect(clusterPlaces([], 3)).toEqual([]);
  });

  it("orders a route without zig-zags", () => {
    const line = [0, 3, 1, 4, 2].map((i) => ({
      id: `p${i}`,
      lat: 41.9,
      lon: 12.45 + i * 0.01,
      visitMinutes: 30,
      must: false,
      popularity: 0,
    }));
    const ids = orderRoute(line).map((p) => p.id);
    expect([ids, [...ids].reverse()]).toContainEqual(["p0", "p1", "p2", "p3", "p4"]);
  });
});

describe("deterministic itinerary", () => {
  it("plans every place exactly once and keeps each day within the pace", () => {
    const places = romePlaces();
    const data = buildDraftItinerary({ places, days: 2, pace: "relaxed", budgetMinutes: 360 });
    expect(data.source).toBe("fallback");
    expect(data.days).toHaveLength(2);
    const all = [...scheduled(data), ...data.excluded.map((x) => x.placeId)];
    expect(new Set(all).size).toBe(all.length);
    expect(all.sort()).toEqual(places.map((p) => p.id).sort());
    expect(data.excluded.length).toBeGreaterThan(0);
    expect(data.excluded[0].reason).toBe("Didn't fit in 2 days at a relaxed pace.");
    const byId = new Map(places.map((p) => [p.id, p]));
    for (const day of data.days) {
      const stops = day.stops.map((s) => ({ placeId: s.placeId, ...byId.get(s.placeId)! }));
      expect(scheduleDay(stops, 360).overMinutes).toBe(0);
      expect(day.title).not.toBe("");
    }
  });

  it("never drops a must-see place, even when the day overflows", () => {
    const places = romePlaces(
      ["Vatican Museums", "Galleria Borghese", "Ostia Antica"],
      ["Vatican Museums", "Galleria Borghese", "Ostia Antica"],
    );
    const data = buildDraftItinerary({ places, days: 1, pace: "relaxed", budgetMinutes: 360 });
    expect(data.excluded).toEqual([]);
    expect(scheduled(data)).toHaveLength(3);
  });

  it("adds left-out places back when the real travel times leave room", () => {
    // Same spot, so no travel: the selection's average leg estimate (15 min each) was too
    // pessimistic, and the fill pass puts the short visit back.
    const [a, b] = romePlaces(["Colosseum", "Roman Forum"], ["Colosseum"]);
    const places = [
      { ...a, visitMinutes: 300 },
      { ...b, ...a, id: b.id, name: b.name, must: false, visitMinutes: 45 },
    ];
    expect(selectPlaces(places, 360).excluded.map((p) => p.id)).toEqual([b.id]);
    const data = buildDraftItinerary({ places, days: 1, pace: "relaxed", budgetMinutes: 360 });
    expect(data.excluded).toEqual([]);
    expect(scheduled(data).sort()).toEqual([a.id, b.id].sort());
  });

  it("pads trips with more days than places with free days", () => {
    const data = buildDraftItinerary({
      places: romePlaces(["Colosseum"]),
      days: 3,
      pace: "balanced",
      budgetMinutes: paceMinutes("balanced"),
    });
    expect(data.days.map((d) => d.stops.length)).toEqual([1, 0, 0]);
    expect(data.days[1].title).toBe("Free day");
  });
});

describe("plan validation", () => {
  const places = romePlaces(
    ["Colosseum", "Roman Forum", "Pantheon", "Vatican Museums"],
    ["Pantheon"],
  );
  const [colosseum, forum, pantheon, vatican] = places;
  const ctx: PlanContext = {
    places: new Map([
      ["P1", colosseum],
      ["P2", forum],
      ["P3", pantheon],
      ["P4", vatican],
    ]),
    days: 2,
    budgetMinutes: 360,
  };
  const stop = (id: string, tip = "") => ({ id, tip });

  it("maps aliases back to places and pads missing days", () => {
    const output: PlannerOutput = {
      days: [
        { title: "Ancient Rome", stops: [stop("P1", "Book ahead."), stop("p2"), stop(" P3 ")] },
      ],
      excluded: [{ id: "P4", reason: "" }],
    };
    const { data, errors } = validatePlan(output, ctx);
    expect(errors).toEqual([]);
    expect(data?.source).toBe("ai");
    expect(data?.days).toEqual([
      {
        title: "Ancient Rome",
        stops: [
          { placeId: colosseum.id, tip: "Book ahead." },
          { placeId: forum.id, tip: null },
          { placeId: pantheon.id, tip: null },
        ],
      },
      { title: "Free day", stops: [] },
    ]);
    expect(data?.excluded).toEqual([{ placeId: vatican.id, reason: "Left out by the planner." }]);
  });

  it("reports unknown, duplicate, missing and wrongly excluded places", () => {
    const { data, errors } = validatePlan(
      {
        days: [
          { title: "A", stops: [stop("P1"), stop("P1"), stop("P9")] },
          { title: "B", stops: [] },
          { title: "C", stops: [] },
        ],
        excluded: [{ id: "P3", reason: "Too busy" }],
      },
      ctx,
    );
    expect(data).toBeUndefined();
    expect(errors).toEqual([
      "Return exactly 2 days, not 3.",
      "P1 (Colosseum) is used more than once.",
      'Unknown place ID "P9": use only IDs from the list.',
      "P3 (Pantheon) is a must-see: it cannot be excluded.",
      'P2 (Roman Forum) is missing: put it in a day or in "excluded".',
      'P4 (Vatican Museums) is missing: put it in a day or in "excluded".',
    ]);
  });

  it("rejects days over the pace budget that contain liked places", () => {
    const { errors } = validatePlan(
      {
        days: [{ title: "Too much", stops: ["P1", "P2", "P3", "P4"].map((id) => stop(id)) }],
        excluded: [],
      },
      ctx,
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/^Day 1 needs .* over the daily budget/);
  });
});

describe("planner output clean-up", () => {
  const rome = romePlaces(["Colosseum", "Pantheon", "Roman Forum"]);

  it("keeps theme titles and replaces bare or prefixed day numbers", () => {
    expect(cleanDayTitle("Vatican and the river", rome)).toBe("Vatican and the river");
    expect(cleanDayTitle("Day 1 – Vatican & Riverfront", rome)).toBe("Vatican & Riverfront");
    expect(cleanDayTitle("day 2: Ancient core", rome)).toBe("Ancient core");
    expect(cleanDayTitle("Day trip to Ostia", rome)).toBe("Day trip to Ostia");
    // Bare numbers and empty titles fall back to the two most popular stops.
    expect(cleanDayTitle("Day 1", rome)).toBe("Colosseum & Pantheon");
    expect(cleanDayTitle("  ", rome)).toBe("Colosseum & Pantheon");
    expect(cleanDayTitle("Day 3", [])).toBe("Free day");
  });

  const stop = (id: string, lon: number) => ({
    id,
    name: id,
    category: "landmark",
    lat: 41.9,
    lon,
    visitMinutes: 30,
    must: false,
    popularity: 0,
  });

  // Five points on an east-west line, about 1.1 km of walking (15 min) apart.
  const line = ["a", "b", "c", "d", "e"].map((id, i) => stop(id, 12.45 + i * 0.01));
  const at = (ids: string) => [...ids].map((id) => line.find((p) => p.id === id)!);
  const sameRoute = (ids: string[], expected: string) =>
    expect([ids.join(""), [...ids].reverse().join("")]).toContain(expected);

  it("re-orders a day only when the model's route is a clear detour", () => {
    // Back and forth: 90 min of travel instead of 60.
    sameRoute(
      fixDetours(at("adbec")).map((p) => p.id),
      "abcde",
    );
    // One swap costs 10 min more than the best order: the model's choice stays.
    expect(fixDetours(at("acbde")).map((p) => p.id)).toEqual(["a", "c", "b", "d", "e"]);
  });

  it("applies the detour fix inside validation and keeps tips with their places", () => {
    const aliases = new Map(line.map((p, i) => [`P${i + 1}`, p]));
    const { data } = validatePlan(
      {
        days: [
          {
            title: "Line",
            stops: ["P1", "P4", "P2", "P5", "P3"].map((id) => ({ id, tip: `Tip ${id}` })),
          },
        ],
        excluded: [],
      },
      { places: aliases, days: 1, budgetMinutes: 600 },
    );
    const stops = data!.days[0].stops;
    sameRoute(
      stops.map((s) => s.placeId),
      "abcde",
    );
    expect(stops.find((s) => s.placeId === "d")?.tip).toBe("Tip P4");
  });
});
