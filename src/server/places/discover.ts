import type { BaseCache } from "@langchain/core/caches";
import { FakeListChatModel } from "@langchain/core/utils/testing";
import { asc, eq } from "drizzle-orm";
import {
  normalizeCategory,
  normalizeName,
  normalizePitch,
  normalizeTags,
  normalizeVisitMinutes,
} from "@/lib/places";
import { rankByInterests } from "@/lib/ranking";
import { fakeDiscoveryResponse } from "@/server/ai/fake";
import { getChatModel, type ChatModelOptions } from "@/server/ai/models";
import { DiscoveryOutputSchema, discoveryMessages } from "@/server/ai/prompts";
import type { Env } from "@/server/env-schema";
import { places } from "@/server/db/schema";
import { haversineKm } from "@/server/itinerary/geo";
import type { City } from "./cities";
import { DAY_MS, type HttpDeps } from "./http-cache";
import {
  fetchImageCredits,
  fetchWikiPages,
  isValidWikiTitle,
  type ImageCredit,
  type WikiPage,
} from "./wikipedia";

/**
 * Workflow A — place discovery, cache-first:
 * city pool in SQLite → deterministic ranking by interests; otherwise
 * LLM proposes tagged attractions → Wikipedia enrichment → drop unmatched/distant/duplicates
 * → saved to the city's shared pool.
 */

export type Place = typeof places.$inferSelect;

export type DiscoveryDeps = HttpDeps & {
  env: Pick<Env, "LLM_MODE" | "OPENROUTER_API_KEY" | "OPENROUTER_MODEL">;
  llmCache?: BaseCache;
};

/** Candidates requested on the first visit to a city and on each "Load more". */
export const INITIAL_CANDIDATES = 40;
export const LOAD_MORE_CANDIDATES = 20;
/** Attractions farther than this from the city centre are dropped (day trips allowed). */
export const MAX_DISTANCE_KM = 30;
/** Wikipedia data older than this is refreshed (no LLM call). */
export const STALE_AFTER_MS = 90 * DAY_MS;

export type DropReason = "invalid-title" | "not-on-wikipedia" | "too-far" | "duplicate";

export type DiscoveryReport = {
  added: Place[];
  dropped: { wikiTitle: string; reason: DropReason }[];
};

export class PlaceDiscoveryError extends Error {
  constructor(
    readonly code: "no-places",
    message: string,
  ) {
    super(message);
    this.name = "PlaceDiscoveryError";
  }
}

type Candidate = {
  name: string;
  wikiTitle: string;
  category: Place["category"];
  tags: string[];
  visitMinutes: number;
  pitch: string;
};

export function getCityPool(db: HttpDeps["db"], cityId: string): Place[] {
  return db.select().from(places).where(eq(places.cityId, cityId)).orderBy(asc(places.name)).all();
}

/** Asks the discovery model for attractions and normalizes them to the app vocabulary. */
async function generateCandidates(
  city: City,
  count: number,
  exclude: readonly string[],
  deps: DiscoveryDeps,
): Promise<Candidate[]> {
  const options: ChatModelOptions = {
    fake: () => new FakeListChatModel({ responses: [fakeDiscoveryResponse(city.name, exclude)] }),
    cache: deps.llmCache,
  };
  const model = getChatModel("discovery", deps.env, options)
    .withStructuredOutput(DiscoveryOutputSchema, { name: "attractions" })
    .withConfig({
      runName: "discover_places",
      tags: ["workflow-a"],
      metadata: { city: city.slug, count, excluded: exclude.length },
    });
  const output = DiscoveryOutputSchema.parse(
    await model.invoke(
      discoveryMessages({ city: city.name, country: city.country, count, exclude }),
    ),
  );
  return output.attractions.map((x) => ({
    name: normalizeName(x.name),
    wikiTitle: x.wikiTitle.trim().replace(/_/g, " "),
    category: normalizeCategory(x.category),
    tags: normalizeTags(x.tags),
    visitMinutes: normalizeVisitMinutes(x.visitMinutes),
    pitch: normalizePitch(x.pitch),
  }));
}

/** Pure filtering step: which candidates survive grounding, and why the others were dropped. */
export function selectGroundedCandidates(
  city: Pick<City, "lat" | "lon">,
  candidates: readonly Candidate[],
  pages: ReadonlyMap<string, WikiPage>,
  existingTitles: ReadonlySet<string>,
): { kept: { candidate: Candidate; page: WikiPage }[]; dropped: DiscoveryReport["dropped"] } {
  const seen = new Set(existingTitles);
  const kept: { candidate: Candidate; page: WikiPage }[] = [];
  const dropped: DiscoveryReport["dropped"] = [];
  for (const candidate of candidates) {
    const { wikiTitle } = candidate;
    if (!isValidWikiTitle(wikiTitle)) {
      dropped.push({ wikiTitle, reason: "invalid-title" });
      continue;
    }
    const page = pages.get(wikiTitle);
    if (!page) {
      dropped.push({ wikiTitle, reason: "not-on-wikipedia" });
    } else if (seen.has(page.title)) {
      dropped.push({ wikiTitle, reason: "duplicate" });
    } else if (haversineKm(city, page) > MAX_DISTANCE_KM) {
      dropped.push({ wikiTitle, reason: "too-far" });
    } else {
      seen.add(page.title);
      kept.push({ candidate, page });
    }
  }
  return { kept, dropped };
}

/** One discovery round: generate → ground on Wikipedia → save new places to the city pool. */
export async function discoverPlaces(
  city: City,
  count: number,
  deps: DiscoveryDeps,
): Promise<DiscoveryReport> {
  const existingTitles = new Set(getCityPool(deps.db, city.id).map((p) => p.wikiTitle));
  const candidates = await generateCandidates(city, count, [...existingTitles], deps);
  const pages = await fetchWikiPages(
    candidates.map((c) => c.wikiTitle).filter(isValidWikiTitle),
    deps,
  );
  const { kept, dropped } = selectGroundedCandidates(city, candidates, pages, existingTitles);
  const credits = await fetchImageCredits(
    kept.flatMap(({ page }) => (page.image ? [page.image.fileName] : [])),
    deps,
  );

  const now = deps.now?.() ?? new Date();
  const rows = kept.map(({ candidate, page }) => {
    const credit = page.image ? credits.get(page.image.fileName) : undefined;
    return {
      id: crypto.randomUUID(),
      cityId: city.id,
      ...candidate,
      wikiTitle: page.title,
      ...wikiFields(page, credit),
      fetchedAt: now,
    } satisfies typeof places.$inferInsert;
  });
  const added = deps.db.transaction((tx) =>
    rows.flatMap((row) => tx.insert(places).values(row).onConflictDoNothing().returning().all()),
  );
  return { added, dropped };
}

/** Wikipedia-derived columns; the photo is kept only with a known license (F9). */
function wikiFields(page: WikiPage, credit: ImageCredit | undefined) {
  return {
    wikiUrl: page.url,
    extract: page.extract,
    lat: page.lat,
    lon: page.lon,
    popularity: page.popularity,
    imageUrl: credit ? page.image!.thumbUrl : null,
    imageAuthor: credit?.author ?? null,
    imageLicense: credit?.license ?? null,
    imageLicenseUrl: credit?.licenseUrl ?? null,
    imagePageUrl: credit?.pageUrl ?? null,
  };
}

/** Re-fetches Wikipedia data for places older than STALE_AFTER_MS. Never calls the LLM. */
export async function refreshStalePlaces(pool: readonly Place[], deps: HttpDeps): Promise<number> {
  const now = deps.now?.() ?? new Date();
  const stale = pool.filter((p) => now.getTime() - p.fetchedAt.getTime() > STALE_AFTER_MS);
  if (stale.length === 0) return 0;

  const pages = await fetchWikiPages(
    stale.map((p) => p.wikiTitle),
    deps,
  );
  const credits = await fetchImageCredits(
    [...pages.values()].flatMap((page) => (page.image ? [page.image.fileName] : [])),
    deps,
  );
  deps.db.transaction((tx) => {
    for (const place of stale) {
      const page = pages.get(place.wikiTitle);
      // Articles that disappeared keep their data; bumping fetchedAt avoids retrying every visit.
      const fields = page
        ? wikiFields(page, page.image ? credits.get(page.image.fileName) : undefined)
        : {};
      tx.update(places)
        .set({ ...fields, fetchedAt: now })
        .where(eq(places.id, place.id))
        .run();
    }
  });
  return stale.length;
}

/** Concurrent requests for the same city share one discovery round (and one LLM call). */
const inFlight = new Map<string, Promise<unknown>>();
function once<T>(key: string, run: () => Promise<T>): Promise<T> {
  const pending = inFlight.get(key) as Promise<T> | undefined;
  if (pending) return pending;
  const promise = run().finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
}

/**
 * Returns the city's place pool, discovering it on first use (one LLM call) and refreshing
 * stale Wikipedia data. A non-empty pool never triggers the LLM again: growing it is an
 * explicit "Load more". Throws PlaceDiscoveryError when nothing could be grounded.
 */
export function ensureCityPool(city: City, deps: DiscoveryDeps): Promise<Place[]> {
  return once(`pool:${city.id}`, async () => {
    const pool = getCityPool(deps.db, city.id);
    if (pool.length > 0) {
      if (await refreshStalePlaces(pool, deps)) return getCityPool(deps.db, city.id);
      return pool;
    }
    const report = await discoverPlaces(city, INITIAL_CANDIDATES, deps);
    const updated = getCityPool(deps.db, city.id);
    if (updated.length === 0) {
      throw new PlaceDiscoveryError(
        "no-places",
        `No verifiable attractions found for ${city.name} (${report.dropped.length} dropped).`,
      );
    }
    return updated;
  });
}

/** "Load more": a discovery round that excludes everything already in the pool. */
export function loadMorePlaces(city: City, deps: DiscoveryDeps): Promise<DiscoveryReport> {
  return once(`more:${city.id}`, () => discoverPlaces(city, LOAD_MORE_CANDIDATES, deps));
}

/** Workflow A entry point: the city's pool ranked by the trip's interests. */
export async function findPlacesForTrip(
  city: City,
  interests: readonly string[],
  deps: DiscoveryDeps,
): Promise<Place[]> {
  return rankByInterests(await ensureCityPool(city, deps), interests);
}
