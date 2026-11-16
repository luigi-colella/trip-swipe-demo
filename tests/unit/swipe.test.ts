import { describe, expect, it } from "vitest";
import { deckReducer, PINNED_CARDS, shortlistCount, type DeckState } from "@/lib/deck";
import { formatVisitTime, humanizeSlug, safeHttpUrl, type PlaceCard } from "@/lib/places";
import { computeTagWeights, rankPlaces, rerankDeck } from "@/lib/ranking";
import { isTripId } from "@/lib/trip";
import { TripSetupSchema } from "@/lib/trip-schemas";

const card = (id: string, category: string, tags: string[], popularity = 100): PlaceCard => ({
  id,
  name: id,
  category,
  tags,
  pitch: "",
  visitMinutes: 60,
  popularity,
  wikiUrl: "https://en.wikipedia.org/wiki/X",
  imageUrl: null,
  imageAuthor: null,
  imageLicense: null,
  imageLicenseUrl: null,
  imagePageUrl: null,
});

describe("swipe-learned weights (F8)", () => {
  it("adds like +1, must +2 and skip -0.5 to each tag and the category", () => {
    const weights = computeTagWeights([
      { decision: "like", place: card("a", "museum", ["art", "history"]) },
      { decision: "must", place: card("b", "museum", ["art"]) },
      { decision: "skip", place: card("c", "park", ["nature", "history"]) },
    ]);
    expect(weights).toEqual({ museum: 3, art: 3, history: 0.5, park: -0.5, nature: -0.5 });
  });

  it("moves places matching liked tags up and skipped ones down", () => {
    const places = [
      card("art-museum", "museum", ["art"]),
      card("garden", "park", ["nature"]),
      card("church", "religious-site", ["religion"]),
    ];
    const ranked = rankPlaces(places, { weights: { art: 3, museum: 3, nature: -2 } });
    expect(ranked.map((p) => p.id)).toEqual(["art-museum", "church", "garden"]);
  });

  it("caps the learned score so one tag cannot dominate everything else", () => {
    const famous = card("famous", "landmark", ["iconic"], 1_000_000);
    const obscure = card("obscure", "museum", ["art"], 0);
    // Uncapped, art=1000 would win by far; capped at +1 it loses to popularity + a small like.
    const ranked = rankPlaces([obscure, famous], { weights: { art: 1000, iconic: 1 } });
    expect(ranked[0].id).toBe("famous");
  });

  it("keeps the pinned cards in place when re-ranking the deck", () => {
    const deck = [card("x", "park", []), card("y", "park", []), card("z", "park", [])];
    const loved = card("loved", "museum", ["art"]);
    const reranked = rerankDeck([...deck, loved], 2, { weights: { art: 5 } });
    expect(reranked.map((p) => p.id)).toEqual(["x", "y", "loved", "z"]);
  });
});

describe("deck reducer (F3)", () => {
  const initial = (): DeckState => ({
    deck: [
      card("a", "museum", ["art"]),
      card("b", "park", ["nature"]),
      card("c", "park", ["nature"]),
      card("d", "park", ["nature"]),
      card("e", "museum", ["art"]),
    ],
    history: [],
    interests: [],
  });

  it("moves the swiped card to the history and re-ranks after the pinned cards", () => {
    const s = deckReducer(initial(), { type: "swipe", placeId: "a", decision: "like" });
    expect(s.history).toMatchObject([{ place: { id: "a" }, decision: "like" }]);
    // b and c stay pinned; e (art, like the liked card) jumps ahead of d.
    expect(s.deck.slice(0, PINNED_CARDS).map((p) => p.id)).toEqual(["b", "c"]);
    expect(s.deck.map((p) => p.id)).toEqual(["b", "c", "e", "d"]);
  });

  it("undo puts the last card back on top; stale undo is ignored", () => {
    let s = deckReducer(initial(), { type: "swipe", placeId: "a", decision: "skip" });
    s = deckReducer(s, { type: "swipe", placeId: "b", decision: "like" });
    expect(deckReducer(s, { type: "undo", placeId: "a" })).toBe(s);
    s = deckReducer(s, { type: "undo", placeId: "b" });
    expect(s.deck[0].id).toBe("b");
    expect(s.history.map((e) => e.place.id)).toEqual(["a"]);
  });

  it("reverts a rejected swipe and a rejected undo", () => {
    const swiped = deckReducer(initial(), { type: "swipe", placeId: "a", decision: "must" });
    const reverted = deckReducer(swiped, { type: "revert-swipe", placeId: "a" });
    expect(reverted.history).toEqual([]);
    expect(reverted.deck[0].id).toBe("a");

    const undone = deckReducer(swiped, { type: "undo", placeId: "a" });
    const redone = deckReducer(undone, { type: "revert-undo", entry: swiped.history[0] });
    expect(redone.history).toEqual(swiped.history);
    expect(redone.deck.some((p) => p.id === "a")).toBe(false);
  });

  it("appends only new places from Load more", () => {
    const s = deckReducer(initial(), {
      type: "append",
      places: [card("a", "museum", []), card("f", "market", ["food"])],
    });
    expect(s.deck.map((p) => p.id)).toEqual(["a", "b", "c", "d", "e", "f"]);
  });

  it("counts likes and must-sees as the shortlist", () => {
    let s = deckReducer(initial(), { type: "swipe", placeId: "a", decision: "like" });
    s = deckReducer(s, { type: "swipe", placeId: "b", decision: "skip" });
    s = deckReducer(s, { type: "swipe", placeId: "c", decision: "must" });
    expect(shortlistCount(s.history)).toBe(2);
  });
});

describe("trip setup validation (F1)", () => {
  const valid = {
    cityQuery: "Rome",
    osmRef: "R41485",
    days: "3",
    pace: "balanced",
    interests: ["art", "food"],
  };

  it("accepts a complete form and coerces days", () => {
    expect(TripSetupSchema.parse(valid)).toMatchObject({ days: 3, interests: ["art", "food"] });
  });

  it.each([
    { days: "0" },
    { days: "8" },
    { pace: "frantic" },
    { osmRef: "" },
    { osmRef: "X123" },
    { interests: ["iconic"] },
    { cityQuery: "R" },
  ])("rejects %o", (override) => {
    expect(TripSetupSchema.safeParse({ ...valid, ...override }).success).toBe(false);
  });
});

describe("card helpers", () => {
  it("formats visit times", () => {
    expect(formatVisitTime(45)).toBe("45 min");
    expect(formatVisitTime(120)).toBe("2 h");
    expect(formatVisitTime(90)).toBe("1 h 30 min");
  });

  it("humanizes vocabulary slugs", () => {
    expect(humanizeSlug("historic-site")).toBe("Historic site");
  });

  it("keeps only http(s) links from third-party data", () => {
    expect(safeHttpUrl("https://commons.wikimedia.org/wiki/File:X.jpg")).toBe(
      "https://commons.wikimedia.org/wiki/File:X.jpg",
    );
    expect(safeHttpUrl("javascript:alert(1)")).toBeNull();
    expect(safeHttpUrl("not a url")).toBeNull();
    expect(safeHttpUrl(null)).toBeNull();
  });
});

describe("isTripId", () => {
  it("accepts UUIDs only, without Zod (client bundles)", () => {
    expect(isTripId("2af496a5-b56a-4289-8e9a-fd3dba40527c")).toBe(true);
    expect(isTripId("2AF496A5-B56A-4289-8E9A-FD3DBA40527C")).toBe(true);
    expect(isTripId("2af496a5-b56a-4289-8e9a-fd3dba40527")).toBe(false);
    expect(isTripId("../2af496a5-b56a-4289-8e9a-fd3dba40527c")).toBe(false);
    expect(isTripId(undefined)).toBe(false);
  });
});
