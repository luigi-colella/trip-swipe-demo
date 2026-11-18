import { z } from "zod";
import { truncateText } from "@/lib/places";
import { DAY_MS, fetchJson, readHttpCache, writeHttpCache, type HttpDeps } from "./http-cache";

/**
 * Wikipedia grounding for places (F9): coordinates, intro extract, photo and 30-day page views,
 * plus author/license of the photo from Wikimedia Commons. Everything returned here is
 * third-party text: store and display it as data, never feed it to an LLM as instructions.
 */
const WIKIPEDIA_API = "https://en.wikipedia.org/w/api.php";
const COMMONS_API = "https://commons.wikimedia.org/w/api.php";
const WIKI_TTL_MS = 7 * DAY_MS;
/** The extracts module returns intros for at most 20 pages per request. */
const WIKI_BATCH = 20;
const COMMONS_BATCH = 50;
const THUMB_WIDTH = 640;
/**
 * Commons serves only standard thumbnail widths (https://w.wiki/GHai): the requested width is
 * rounded up to 960 px, and an original narrower than that comes back unscaled, often a much
 * heavier file. Such originals get the next smaller standard width instead.
 */
const SMALL_THUMB_WIDTH = 500;
const ORIGINAL_PATH =
  /^(\/wikipedia\/[^/]+)\/([0-9a-f]\/[0-9a-f]{2}\/([^/]+\.(?:jpe?g|png|webp)))$/i;
const PAGEVIEW_DAYS = 30;

export type WikiPage = {
  title: string;
  url: string;
  extract: string | null;
  lat: number;
  lon: number;
  /** Page views over the last 30 days: a deterministic popularity signal. */
  popularity: number;
  image: { fileName: string; thumbUrl: string } | null;
};

export type ImageCredit = {
  author: string;
  license: string;
  licenseUrl: string | null;
  pageUrl: string;
};

/** Cached per requested title; `null` page = no usable article (missing, disambiguation, no coordinates). */
type CachedWikiLookup = { page: WikiPage | null };
type CachedCredit = { credit: ImageCredit | null };

/**
 * Continuation parameters (`continue`, `pvipcontinue`…) sent back as they are in the next
 * request, so only `*continue` names and short values are accepted; anything else is ignored.
 */
const ContinueParams = z
  .record(z.string().regex(/^[a-z]*continue$/), z.string().max(300))
  .refine((params) => Object.keys(params).length <= 5)
  .optional()
  .catch(undefined);

const WikiResponse = z.object({
  continue: ContinueParams,
  query: z
    .object({
      normalized: z.array(z.object({ from: z.string(), to: z.string() })).optional(),
      redirects: z.array(z.object({ from: z.string(), to: z.string() })).optional(),
      pages: z
        .array(
          z.object({
            title: z.string(),
            missing: z.boolean().optional(),
            invalid: z.boolean().optional(),
            fullurl: z.string().optional(),
            extract: z.string().optional(),
            pageimage: z.string().optional(),
            thumbnail: z.object({ source: z.string(), width: z.number().optional() }).optional(),
            coordinates: z
              .array(
                z.object({ lat: z.number(), lon: z.number(), primary: z.boolean().optional() }),
              )
              .optional(),
            pageprops: z.record(z.string(), z.unknown()).optional(),
            pageviews: z.record(z.string(), z.number().nullable()).optional(),
          }),
        )
        .optional(),
    })
    .optional(),
});

const CommonsResponse = z.object({
  query: z
    .object({
      normalized: z.array(z.object({ from: z.string(), to: z.string() })).optional(),
      pages: z
        .array(
          z.object({
            title: z.string(),
            missing: z.boolean().optional(),
            imageinfo: z
              .array(
                z.object({
                  extmetadata: z
                    .record(z.string(), z.object({ value: z.unknown() }).loose())
                    .optional(),
                }),
              )
              .optional(),
          }),
        )
        .optional(),
    })
    .optional(),
});

/** Titles we are willing to send to the API (the LLM produces them, so validate). */
export function isValidWikiTitle(title: string): boolean {
  return title.length > 0 && title.length <= 255 && !/[|#<>[\]{}]/.test(title);
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Removes tracking query parameters Wikimedia appends to thumbnail URLs, and swaps an unscaled
 * raster original at least SMALL_THUMB_WIDTH wide for its standard thumbnail of that width.
 */
function cleanThumbUrl({ source, width }: { source: string; width?: number }): string {
  const u = new URL(source);
  for (const key of [...u.searchParams.keys()])
    if (key.startsWith("utm_")) u.searchParams.delete(key);
  // An original: /wikipedia/<project>/<a>/<ab>/<file>; thumbnails live under /thumb/.
  const original = ORIGINAL_PATH.exec(u.pathname);
  if (u.hostname === "upload.wikimedia.org" && original && (width ?? 0) >= SMALL_THUMB_WIDTH) {
    const [, project, path, file] = original;
    u.pathname = `${project}/thumb/${path}/${SMALL_THUMB_WIDTH}px-${file}`;
  }
  return u.toString();
}

/** Plain text from Commons' HTML metadata (author names often come wrapped in links). */
export function htmlToText(html: string): string {
  const text = html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&");
  return truncateText(text, 120);
}

/** Follows normalization and redirects from a requested title to the final page title. */
function resolveTitle(
  title: string,
  normalized: Map<string, string>,
  redirects: Map<string, string>,
): string {
  let t = normalized.get(title) ?? title;
  for (let hops = 0, next = redirects.get(t); hops < 3 && next !== undefined; hops++) {
    t = next;
    next = redirects.get(t);
  }
  return t;
}

export function parseWikiResponse(
  requested: readonly string[],
  body: unknown,
): Map<string, WikiPage | null> {
  const query = WikiResponse.parse(body).query;
  const normalized = new Map((query?.normalized ?? []).map((n) => [n.from, n.to]));
  const redirects = new Map((query?.redirects ?? []).map((r) => [r.from, r.to]));
  const pages = new Map((query?.pages ?? []).map((p) => [p.title, p]));

  const out = new Map<string, WikiPage | null>();
  for (const title of requested) {
    const p = pages.get(resolveTitle(title, normalized, redirects));
    const coord = p?.coordinates?.find((c) => c.primary) ?? p?.coordinates?.[0];
    if (!p || p.missing || p.invalid || !coord || p.pageprops?.disambiguation !== undefined) {
      out.set(title, null);
      continue;
    }
    const popularity = Object.values(p.pageviews ?? {}).reduce<number>((s, v) => s + (v ?? 0), 0);
    out.set(title, {
      title: p.title,
      url:
        p.fullurl ??
        `https://en.wikipedia.org/wiki/${encodeURIComponent(p.title.replace(/ /g, "_"))}`,
      extract: p.extract?.trim() ? truncateText(p.extract, 600) : null,
      lat: coord.lat,
      lon: coord.lon,
      popularity,
      image:
        p.pageimage && p.thumbnail
          ? { fileName: p.pageimage, thumbUrl: cleanThumbUrl(p.thumbnail) }
          : null,
    });
  }
  return out;
}

function wikiBatchUrl(titles: readonly string[], continueParams: Record<string, string> = {}) {
  return `${WIKIPEDIA_API}?${new URLSearchParams({
    action: "query",
    format: "json",
    formatversion: "2",
    redirects: "1",
    titles: titles.join("|"),
    prop: "coordinates|pageimages|extracts|info|pageviews|pageprops",
    // Per-module limits apply to the whole batch: the coordinates default (10) would silently
    // drop half of a 20-title batch into a continuation we do not follow.
    colimit: "max",
    pilimit: "max",
    exlimit: "max",
    ppprop: "disambiguation",
    inprop: "url",
    piprop: "thumbnail|name",
    pithumbsize: String(THUMB_WIDTH),
    exintro: "1",
    explaintext: "1",
    exsentences: "3",
    pvipdays: String(PAGEVIEW_DAYS),
    ...continueParams,
  })}`;
}

/**
 * Extra requests allowed per batch. Page views come from a separate service: Wikipedia
 * answers them only for the pages it has at hand and returns a continuation for the rest
 * (typically the less visited pages of a city nobody asked about recently).
 */
export const MAX_WIKI_CONTINUATIONS = 3;

type WikiBody = z.infer<typeof WikiResponse>;

/** Adds what a continuation returned (page views, any missing field) to the first answer. */
function mergeContinuation(target: WikiBody, more: WikiBody): void {
  const pages = new Map((target.query?.pages ?? []).map((p) => [p.title, p]));
  for (const extra of more.query?.pages ?? []) {
    const page = pages.get(extra.title);
    if (!page) continue;
    const pageviews = { ...extra.pageviews, ...page.pageviews };
    Object.assign(page, { ...extra, ...page, pageviews });
  }
}

/** One batch, following page-view continuations (bounded). */
async function fetchWikiBatch(titles: readonly string[]): Promise<WikiBody> {
  const body = WikiResponse.parse(await fetchJson(wikiBatchUrl(titles)));
  let next = body.continue;
  for (let round = 0; next && round < MAX_WIKI_CONTINUATIONS; round++) {
    const more = WikiResponse.parse(await fetchJson(wikiBatchUrl(titles, next)));
    mergeContinuation(body, more);
    next = more.continue;
  }
  if (next) console.warn("Wikipedia continuation not followed further: some page views missing");
  return body;
}

/**
 * Looks up English Wikipedia articles in batches, cached per requested title for 7 days.
 * Returns only usable pages (with coordinates), keyed by the requested title.
 */
export async function fetchWikiPages(
  titles: readonly string[],
  deps: HttpDeps,
): Promise<Map<string, WikiPage>> {
  const now = deps.now?.() ?? new Date();
  const unique = [...new Set(titles.filter(isValidWikiTitle))];
  const found = new Map<string, WikiPage>();
  const misses: string[] = [];

  for (const title of unique) {
    const hit = readHttpCache(deps.db, `wiki:page:${title}`, now) as CachedWikiLookup | undefined;
    if (hit === undefined) misses.push(title);
    else if (hit.page) found.set(title, hit.page);
  }

  for (const batch of chunk(misses, WIKI_BATCH)) {
    const parsed = parseWikiResponse(batch, await fetchWikiBatch(batch));
    for (const [title, page] of parsed) {
      writeHttpCache(
        deps.db,
        `wiki:page:${title}`,
        { page } satisfies CachedWikiLookup,
        WIKI_TTL_MS,
        now,
      );
      if (page) found.set(title, page);
    }
  }
  return found;
}

function metaValue(
  meta: Record<string, { value: unknown }> | undefined,
  key: string,
): string | null {
  const v = meta?.[key]?.value;
  return typeof v === "string" && v.trim() ? v : null;
}

export function parseCommonsResponse(
  fileNames: readonly string[],
  body: unknown,
): Map<string, ImageCredit | null> {
  const query = CommonsResponse.parse(body).query;
  const normalized = new Map((query?.normalized ?? []).map((n) => [n.from, n.to]));
  const pages = new Map((query?.pages ?? []).map((p) => [p.title, p]));

  const out = new Map<string, ImageCredit | null>();
  for (const name of fileNames) {
    const requested = `File:${name}`;
    const page = pages.get(normalized.get(requested) ?? requested);
    const meta = page?.imageinfo?.[0]?.extmetadata;
    const license = metaValue(meta, "LicenseShortName");
    if (!page || page.missing || !license) {
      out.set(name, null);
      continue;
    }
    const artist = metaValue(meta, "Artist");
    const licenseUrl = metaValue(meta, "LicenseUrl");
    out.set(name, {
      author: artist ? htmlToText(artist) || "Unknown author" : "Unknown author",
      license: htmlToText(license),
      licenseUrl: licenseUrl && /^https?:\/\//.test(licenseUrl) ? licenseUrl : null,
      pageUrl: `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, "_")).replace("%3A", ":")}`,
    });
  }
  return out;
}

/**
 * Author and license of Commons files (cached per file for 7 days). Files without license
 * metadata (e.g. non-free images hosted only on Wikipedia) are omitted: callers drop the photo.
 */
export async function fetchImageCredits(
  fileNames: readonly string[],
  deps: HttpDeps,
): Promise<Map<string, ImageCredit>> {
  const now = deps.now?.() ?? new Date();
  const found = new Map<string, ImageCredit>();
  const misses: string[] = [];

  for (const name of new Set(fileNames)) {
    const hit = readHttpCache(deps.db, `commons:file:${name}`, now) as CachedCredit | undefined;
    if (hit === undefined) misses.push(name);
    else if (hit.credit) found.set(name, hit.credit);
  }

  for (const batch of chunk(misses, COMMONS_BATCH)) {
    const url = `${COMMONS_API}?${new URLSearchParams({
      action: "query",
      format: "json",
      formatversion: "2",
      titles: batch.map((n) => `File:${n}`).join("|"),
      prop: "imageinfo",
      iiprop: "extmetadata",
      iiextmetadatafilter: "Artist|LicenseShortName|LicenseUrl",
    })}`;
    const parsed = parseCommonsResponse(batch, await fetchJson(url));
    for (const [name, credit] of parsed) {
      writeHttpCache(
        deps.db,
        `commons:file:${name}`,
        { credit } satisfies CachedCredit,
        WIKI_TTL_MS,
        now,
      );
      if (credit) found.set(name, credit);
    }
  }
  return found;
}
