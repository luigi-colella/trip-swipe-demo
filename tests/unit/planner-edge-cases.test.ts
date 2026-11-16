import { describe, expect, it } from "vitest";
import { parseEnv } from "@/server/env-schema";
import { plannerMessages, plannerRepairMessage } from "@/server/ai/prompts";
import {
  clusterPlaces,
  groupMinutes,
  rebalanceGroups,
  selectPlaces,
  travelMinutes,
  type ClusterPlace,
} from "@/server/itinerary/cluster";
import {
  buildDraftItinerary,
  didNotFitReason,
  type PlannerPlace,
} from "@/server/itinerary/fallback";
import { planItinerary } from "@/server/itinerary/graph";
import { romePlaces } from "../helpers/rome";

const COLOSSEUM = { lat: 41.8902, lon: 12.4922 };
const VATICAN = { lat: 41.9065, lon: 12.4536 };
const OSTIA = { lat: 41.7556, lon: 12.2919 };

const place = (
  id: string,
  at: { lat: number; lon: number },
  visitMinutes: number,
  extra: Partial<PlannerPlace> = {},
): PlannerPlace => ({
  id,
  name: id,
  category: "landmark",
  ...at,
  visitMinutes,
  must: false,
  popularity: 100,
  ...extra,
});

describe("cluster edge cases", () => {
  it("breaks priority ties by id, so the selection is deterministic", () => {
    const [b, a] = [place("b", COLOSSEUM, 300), place("a", COLOSSEUM, 300)];
    expect(selectPlaces([b, a], 315).kept.map((p) => p.id)).toEqual(["a"]);
  });

  it("puts places at the same spot into one group", () => {
    const same = ["a", "b", "c"].map((id) => place(id, COLOSSEUM, 30));
    const groups = clusterPlaces(same, 2);
    expect(groups).toHaveLength(1);
    expect(groups[0].map((p) => p.id).sort()).toEqual(["a", "b", "c"]);
  });

  it("moves places from an overloaded day into an empty one", () => {
    const full = ["a", "b", "c"].map((id) => place(id, COLOSSEUM, 150));
    const groups = rebalanceGroups([full], 2, 360);
    expect(groups.map((g) => g.length).sort()).toEqual([1, 2]);
    for (const g of groups) expect(groupMinutes(g)).toBeLessThanOrEqual(360);
  });

  it("prefers the nearest day with room and stops when nothing fits", () => {
    const near = [place("n", VATICAN, 60)];
    const far = [place("f", OSTIA, 60)];
    const over = ["a", "b"].map((id) => place(id, VATICAN, 200));
    const groups = rebalanceGroups([over, near, far], 3, 360);
    // One of the long visits joins the Vatican day, not the Ostia one.
    expect(groups[1].map((p) => p.id)).toContain("n");
    expect(groups[1]).toHaveLength(2);
    expect(groups[2].map((p) => p.id)).toEqual(["f"]);

    // A single place longer than the budget cannot go anywhere.
    const huge = [place("x", VATICAN, 400)];
    expect(rebalanceGroups([huge], 2, 360)).toEqual([huge, []]);
  });

  it("measures travel along a route in its given order", () => {
    const route: ClusterPlace[] = [place("a", COLOSSEUM, 0), place("b", VATICAN, 0)];
    expect(travelMinutes(route)).toBeGreaterThan(0);
    expect(travelMinutes(route.slice(0, 1))).toBe(0);
  });
});

describe("deterministic itinerary edge cases", () => {
  it("drops the least popular liked place when real travel makes the day too long", () => {
    // Estimated with 15 min per leg the three fit; the trip to Ostia takes far longer.
    const places = [
      place("colosseum", COLOSSEUM, 120, { must: true, popularity: 9000 }),
      place("ostia", OSTIA, 120, { popularity: 5000 }),
      place("forum", { lat: 41.8925, lon: 12.4853 }, 60, { popularity: 4000 }),
    ];
    expect(selectPlaces(places, 360).excluded).toEqual([]);
    const data = buildDraftItinerary({ places, days: 1, pace: "relaxed", budgetMinutes: 360 });
    expect(data.excluded).toEqual([{ placeId: "forum", reason: didNotFitReason(1, "relaxed") }]);
    expect(data.days[0].stops.map((s) => s.placeId).sort()).toEqual(["colosseum", "ostia"]);
  });

  it("puts left-out places back on the day where they add the least time", () => {
    // 10 short visits at each of two distant spots: the selection estimate keeps 16 of 20,
    // but there is room for all of them, each on the day spent at its own spot.
    const at = (spot: typeof COLOSSEUM, prefix: string) =>
      Array.from({ length: 10 }, (_, i) =>
        place(`${prefix}${i}`, spot, 30, { popularity: 1000 - i * 10 - (prefix === "v" ? 5 : 0) }),
      );
    const places = [...at(COLOSSEUM, "c"), ...at(VATICAN, "v")];
    expect(selectPlaces(places, 720).excluded).toHaveLength(4);
    const data = buildDraftItinerary({ places, days: 2, pace: "relaxed", budgetMinutes: 360 });
    expect(data.excluded).toEqual([]);
    const prefixes = data.days.map((d) => new Set(d.stops.map((s) => s.placeId[0])));
    expect(prefixes.map((p) => [...p])).toEqual([["c"], ["v"]]);
  });

  it("phrases the reason for one day", () => {
    expect(didNotFitReason(1, "intense")).toBe("Didn't fit in 1 day at a intense pace.");
  });
});

describe("planner prompt", () => {
  const input = {
    city: "Rome",
    country: "Italy",
    days: 1,
    pace: "relaxed",
    budgetMinutes: 360,
    places: [
      { id: "P1", name: "Colosseum", category: "landmark", visitMinutes: 120, must: true },
      { id: "P2", name: "Forum", category: "historic-site", visitMinutes: 90, must: false },
    ],
    draft: [["P1", "P2"], []],
  };

  it("lists places by alias, the budget, the draft and the city as delimited data", () => {
    const [[system, systemText], [human, text]] = plannerMessages(input);
    expect([system, human]).toEqual(["system", "human"]);
    expect(systemText).toContain("not instructions");
    expect(text).toContain("Plan 1 day at a relaxed pace: at most 360 minutes");
    expect(text).toContain("<city>Rome, Italy</city>");
    expect(text).toContain("P1 | Colosseum | landmark | 120 min | must-see");
    expect(text).toContain("P2 | Forum | historic-site | 90 min | liked");
    expect(text).toContain("Day 1: P1, P2\nDay 2: (empty)");
    expect(text).not.toContain("alternative");
  });

  it("asks for an alternative only when the current plan is given", () => {
    const [, [, text]] = plannerMessages({ ...input, days: 2, previous: [["P2"], ["P1"]] });
    expect(text).toContain("Plan 2 days");
    expect(text).toContain("propose a different arrangement:\nDay 1: P2\nDay 2: P1");
  });

  it("is identical for identical input (the exact-match cache depends on it)", () => {
    expect(plannerMessages(input)).toEqual(plannerMessages(structuredClone(input)));
  });

  it("lists the validator's errors in the repair turn", () => {
    expect(plannerRepairMessage(["A is missing.", "B twice."])).toEqual([
      "human",
      "Your plan has these problems:\n- A is missing.\n- B twice.\nReturn the full corrected plan.",
    ]);
  });
});

describe("planner graph edge cases", () => {
  const env = parseEnv({ LLM_MODE: "fake" });

  it("refuses an empty shortlist", async () => {
    await expect(
      planItinerary(
        { city: { name: "Rome", country: "Italy" }, days: 1, pace: "relaxed", places: [] },
        { env },
      ),
    ).rejects.toThrow("Cannot plan an empty shortlist.");
  });

  it("plans an alternative even when the current plan has places no longer shortlisted", async () => {
    const places = romePlaces(["Colosseum", "Pantheon"]);
    const result = await planItinerary(
      {
        city: { name: "Rome", country: "Italy" },
        days: 1,
        pace: "relaxed",
        places,
        previous: {
          days: [{ title: "Old", stops: [{ placeId: "removed-from-shortlist", tip: null }] }],
          excluded: [],
          source: "ai",
        },
      },
      { env },
    );
    expect(result.data.source).toBe("ai");
    expect(result.data.days[0].stops).toHaveLength(2);
  });

  it("keeps the draft's exclusions and reasons in the offline plan", async () => {
    const places = romePlaces();
    const result = await planItinerary(
      { city: { name: "Rome", country: "Italy" }, days: 1, pace: "relaxed", places },
      { env },
    );
    expect(result.data.source).toBe("ai");
    expect(result.data.excluded.length).toBeGreaterThan(0);
    expect(result.data.excluded[0].reason).toBe(didNotFitReason(1, "relaxed"));
  });
});
