import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

/**
 * Network mocks for third-party APIs (msw intercepts the real `fetch`). The server is started
 * for every test file by tests/setup/msw.ts and rejects any request without a handler, so tests
 * can never reach the real network.
 */
export const server = setupServer();

export type StubArticle = {
  lat: number;
  lon: number;
  image?: string;
  /** Titles that redirect to this article. */
  redirects?: string[];
  disambiguation?: boolean;
  views?: number;
};

/**
 * Installs handlers for Wikipedia, Commons and Photon that answer the query shapes the app
 * sends from a small fixture set. Returns the list of requested URLs for assertions.
 */
export function mockWikimedia(
  articles: Record<string, StubArticle>,
  options: {
    licensedFiles?: string[];
    failWikipedia?: boolean;
    /**
     * Like the real API for pages it has no page views at hand for: only this many pages per
     * request get them, the rest come through `pvipcontinue` continuations.
     */
    pageviewsPerRequest?: number;
  } = {},
): { calls: string[] } {
  const calls: string[] = [];
  const licensed = new Set(
    options.licensedFiles ?? Object.values(articles).flatMap((a) => a.image ?? []),
  );
  const redirectTo = new Map(
    Object.entries(articles).flatMap(([title, a]) => (a.redirects ?? []).map((r) => [r, title])),
  );
  const titlesOf = (url: URL) => url.searchParams.get("titles")?.split("|") ?? [];

  server.use(
    http.get("https://en.wikipedia.org/w/api.php", ({ request }) => {
      calls.push(request.url);
      if (options.failWikipedia) {
        return HttpResponse.json({ error: "unavailable" }, { status: 503 });
      }
      const url = new URL(request.url);
      const titles = titlesOf(url);
      const redirects = titles
        .filter((t) => redirectTo.has(t))
        .map((t) => ({ from: t, to: redirectTo.get(t)! }));
      // Like the real API: without colimit only the first 10 pages get coordinates.
      const coordLimit = url.searchParams.get("colimit") === "max" ? Infinity : 10;
      const perRequest = options.pageviewsPerRequest ?? Infinity;
      const resolved = titles.map((t) => redirectTo.get(t) ?? t);
      const from = Math.max(0, resolved.indexOf(url.searchParams.get("pvipcontinue") ?? ""));
      const withViews = (i: number) => i >= from && i < from + perRequest;
      const next = resolved[from + perRequest];
      const pages = titles.map((requested, i) => {
        const title = redirectTo.get(requested) ?? requested;
        const a = articles[title];
        if (!a) return { title, missing: true };
        return {
          title,
          fullurl: `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`,
          extract: `${title} is a well-known attraction.`,
          ...(i < coordLimit ? { coordinates: [{ lat: a.lat, lon: a.lon, primary: true }] } : {}),
          ...(a.image
            ? {
                pageimage: a.image,
                thumbnail: { source: `https://upload.wikimedia.org/${a.image}?utm_source=x` },
              }
            : {}),
          ...(a.disambiguation ? { pageprops: { disambiguation: "" } } : {}),
          ...(withViews(i)
            ? { pageviews: { "2026-11-01": a.views ?? 100, "2026-11-02": null } }
            : {}),
        };
      });
      return HttpResponse.json({
        ...(next === undefined
          ? { batchcomplete: true }
          : { continue: { pvipcontinue: next, continue: "||" } }),
        query: { redirects, pages },
      });
    }),

    http.get("https://commons.wikimedia.org/w/api.php", ({ request }) => {
      calls.push(request.url);
      const pages = titlesOf(new URL(request.url)).map((t) => {
        const title = t.replace(/_/g, " ");
        if (!licensed.has(t.replace(/^File:/, ""))) return { title, missing: true };
        return {
          title,
          imageinfo: [
            {
              extmetadata: {
                Artist: {
                  value: '<a href="//commons.wikimedia.org/wiki/User:Ann">Ann &amp; Bob</a>',
                },
                LicenseShortName: { value: "CC BY-SA 4.0" },
                LicenseUrl: { value: "https://creativecommons.org/licenses/by-sa/4.0" },
              },
            },
          ],
        };
      });
      return HttpResponse.json({ batchcomplete: true, query: { pages } });
    }),

    http.get("https://photon.komoot.io/api/", ({ request }) => {
      calls.push(request.url);
      return HttpResponse.json({
        features: [
          {
            geometry: { coordinates: [12.4829, 41.8933] },
            properties: {
              osm_type: "R",
              osm_id: 41485,
              name: "Rome",
              state: "Lazio",
              country: "Italy",
              countrycode: "IT",
            },
          },
        ],
      });
    }),
  );
  return { calls };
}
