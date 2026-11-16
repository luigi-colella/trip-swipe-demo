import { FakeListChatModel } from "@langchain/core/utils/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SqliteLlmCache } from "@/server/ai/cache";
import { llmCache } from "@/server/db/schema";
import { parseEnv } from "@/server/env-schema";
import { upsertCity, type City } from "@/server/places/cities";
import {
  ensureCityPool,
  findPlacesForTrip,
  getCityPool,
  loadMorePlaces,
  PlaceDiscoveryError,
  type DiscoveryDeps,
} from "@/server/places/discover";
import { DAY_MS, HttpError } from "@/server/places/http-cache";
import { fetchImageCredits, fetchWikiPages } from "@/server/places/wikipedia";
import { createTestDatabase } from "../helpers/db";
import { mockWikimedia, server, type StubArticle } from "../helpers/msw";

/** Fake-mode discovery returns the Rome fixture list (src/server/ai/fake.ts). */
const near = (views = 100, extra: Partial<StubArticle> = {}): StubArticle => ({
  lat: 41.9,
  lon: 12.48,
  views,
  ...extra,
});
const ROME_ARTICLES: Record<string, StubArticle> = {
  Colosseum: near(1000, { image: "Colosseo.jpg" }),
  "Roman Forum": near(),
  "Pantheon, Rome": near(),
  "Trevi Fountain": near(100, { image: "Trevi.jpg" }),
  "Vatican Museums": near(),
  "St. Peter's Basilica": near(),
  "Spanish Steps": near(),
  "Piazza Navona": near(),
  "Castel Sant'Angelo": near(),
  "Galleria Borghese": near(),
  Trastevere: { lat: 45.4, lon: 12.3 }, // ~390 km away: dropped as too far
  // "Villa Borghese gardens" is missing: dropped as not on Wikipedia
};
const ROME = {
  osmRef: "R41485",
  name: "Rome",
  state: "Lazio",
  country: "Italy",
  countryCode: "IT",
  lat: 41.8933,
  lon: 12.4829,
};

let t: ReturnType<typeof createTestDatabase>;
let rome: City;
let llmCalls: ReturnType<typeof vi.spyOn>;

function deps(overrides: Partial<DiscoveryDeps> = {}): DiscoveryDeps {
  return {
    db: t.db,
    env: parseEnv({ LLM_MODE: "fake" }),
    llmCache: new SqliteLlmCache(t.db),
    ...overrides,
  };
}

beforeEach(() => {
  t = createTestDatabase();
  rome = upsertCity(t.db, ROME);
  // Default network for every test; later mockWikimedia() calls take precedence.
  mockWikimedia(ROME_ARTICLES, { licensedFiles: ["Colosseo.jpg"] });
  llmCalls = vi.spyOn(FakeListChatModel.prototype, "_generate");
});
afterEach(() => {
  vi.restoreAllMocks();
  t.cleanup();
});

describe("workflow A: place discovery", () => {
  it("generates, grounds on Wikipedia and saves the pool on a cache miss", async () => {
    const pool = await ensureCityPool(rome, deps());

    expect(llmCalls).toHaveBeenCalledTimes(1);
    expect(pool.map((p) => p.wikiTitle)).toHaveLength(10);
    expect(pool.map((p) => p.wikiTitle)).not.toContain("Trastevere");

    const colosseum = pool.find((p) => p.wikiTitle === "Colosseum")!;
    expect(colosseum).toMatchObject({
      category: "historic-site",
      tags: ["history", "iconic"],
      visitMinutes: 120,
      popularity: 1000,
      imageUrl: "https://upload.wikimedia.org/Colosseo.jpg",
      imageAuthor: "Ann & Bob",
      imageLicense: "CC BY-SA 4.0",
      imageLicenseUrl: "https://creativecommons.org/licenses/by-sa/4.0",
      imagePageUrl: "https://commons.wikimedia.org/wiki/File:Colosseo.jpg",
      extract: "Colosseum is a well-known attraction.",
    });
    // Photo without license metadata: dropped, the place is kept.
    expect(pool.find((p) => p.wikiTitle === "Trevi Fountain")?.imageUrl).toBeNull();
  });

  it("grounds every title of a 20-title batch (regression: coordinates limit)", async () => {
    const titles = Array.from({ length: 20 }, (_, i) => `Sight ${i}`);
    const { calls } = mockWikimedia(Object.fromEntries(titles.map((x) => [x, near()])));
    const pages = await fetchWikiPages(titles, { db: t.db });
    expect(calls).toHaveLength(1);
    expect(pages.size).toBe(20);
  });

  it("serves an existing pool without calling the LLM or the network", async () => {
    await ensureCityPool(rome, deps());
    llmCalls.mockClear();
    const { calls } = mockWikimedia(ROME_ARTICLES);

    const pool = await ensureCityPool(rome, deps());
    expect(pool).toHaveLength(10);
    expect(llmCalls).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  it("reuses the cached LLM answer when a retry follows a Wikipedia outage", async () => {
    mockWikimedia(ROME_ARTICLES, { failWikipedia: true });
    await expect(ensureCityPool(rome, deps())).rejects.toBeInstanceOf(HttpError);
    expect(getCityPool(t.db, rome.id)).toHaveLength(0);
    expect(t.db.select().from(llmCache).all()).toHaveLength(1);

    llmCalls.mockClear();
    server.resetHandlers(); // Wikipedia is back
    mockWikimedia(ROME_ARTICLES);
    expect(await ensureCityPool(rome, deps())).toHaveLength(10);
    expect(llmCalls).not.toHaveBeenCalled();
  });

  it("shares one discovery round between concurrent requests", async () => {
    const [a, b] = await Promise.all([ensureCityPool(rome, deps()), ensureCityPool(rome, deps())]);
    expect(a).toHaveLength(10);
    expect(b).toEqual(a);
    expect(llmCalls).toHaveBeenCalledTimes(1);
  });

  it("refreshes stale Wikipedia data without calling the LLM", async () => {
    await ensureCityPool(rome, deps());
    llmCalls.mockClear();
    const later = new Date(Date.now() + 91 * DAY_MS);
    const { calls } = mockWikimedia({ ...ROME_ARTICLES, Colosseum: near(5000) });

    const pool = await ensureCityPool(rome, deps({ now: () => later }));
    expect(llmCalls).not.toHaveBeenCalled();
    expect(calls.length).toBeGreaterThan(0);
    expect(pool.find((p) => p.wikiTitle === "Colosseum")).toMatchObject({
      popularity: 5000,
      imageUrl: null,
    });
    expect(pool.every((p) => p.fetchedAt.getTime() >= later.getTime() - 1000)).toBe(true);
  });

  it("loads more places excluding the ones already in the pool", async () => {
    await ensureCityPool(rome, deps());
    llmCalls.mockClear();

    const report = await loadMorePlaces(rome, deps());
    const prompt = JSON.stringify(llmCalls.mock.calls[0][0]);
    expect(prompt).toContain("- Colosseum");
    // The fixture minus exclusions leaves only the two candidates that fail grounding.
    expect(report.added).toHaveLength(0);
    expect(report.dropped).toEqual([
      { wikiTitle: "Trastevere", reason: "too-far" },
      { wikiTitle: "Villa Borghese gardens", reason: "not-on-wikipedia" },
    ]);
  });

  it("fails clearly when nothing can be grounded", async () => {
    const nowhere = upsertCity(t.db, { ...ROME, osmRef: "R1", name: "Nowhere", state: null });
    await expect(ensureCityPool(nowhere, deps())).rejects.toBeInstanceOf(PlaceDiscoveryError);
  });

  it("ranks the pool by the trip's interests", async () => {
    const plain = await findPlacesForTrip(rome, [], deps());
    expect(plain[0].wikiTitle).toBe("Colosseum");

    const art = await findPlacesForTrip(rome, ["art"], deps());
    expect(art[0].tags).toContain("art");
  });
});

describe("workflow A edge cases", () => {
  it("keeps the data of articles that disappeared and refreshes the others", async () => {
    await ensureCityPool(rome, deps());
    const later = new Date(Date.now() + 91 * DAY_MS);
    // Only the Colosseum is still on Wikipedia, now with a licensed photo.
    mockWikimedia({ Colosseum: near(7000, { image: "New.jpg" }) });
    const pool = await ensureCityPool(rome, deps({ now: () => later }));
    expect(pool.find((p) => p.wikiTitle === "Colosseum")).toMatchObject({
      popularity: 7000,
      imageLicense: "CC BY-SA 4.0",
    });
    const forum = pool.find((p) => p.wikiTitle === "Roman Forum")!;
    expect(forum.popularity).toBe(100);
    expect(forum.fetchedAt.getTime()).toBe(later.getTime() - (later.getTime() % 1000));
  });

  it("serves photo credits from the cache, including files without a license", async () => {
    await fetchImageCredits(["Colosseo.jpg", "Trevi.jpg"], { db: t.db });
    const { calls } = mockWikimedia(ROME_ARTICLES, { licensedFiles: ["Colosseo.jpg"] });
    const credits = await fetchImageCredits(["Colosseo.jpg", "Trevi.jpg"], { db: t.db });
    expect(calls).toEqual([]);
    // Trevi.jpg has no license: its cached "no credit" answer keeps the photo out.
    expect([...credits.keys()]).toEqual(["Colosseo.jpg"]);
  });
});
