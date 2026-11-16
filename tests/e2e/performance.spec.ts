import { gzipSync } from "node:zlib";
import { expect, test, type Page } from "@playwright/test";
import { planRomeTrip, serveBlankTiles } from "./helpers";

/**
 * Performance budgets (§2) on the production build: initial JavaScript < 200 KB gzipped per
 * page (Leaflet and the chat load later, on demand) and CLS < 0.05 while each page loads
 * with a 4× slower CPU. Lighthouse runs are manual (README).
 */

const MAX_INITIAL_JS_GZIP = 200 * 1024;
const MAX_CLS = 0.05;

/**
 * Gzipped size of the scripts a page's HTML loads: script tags and script preloads, except
 * the `noModule` polyfills that modern browsers skip.
 */
async function initialJsBytes(page: Page, path: string): Promise<number> {
  const html = await (await page.request.get(path)).text();
  const sources = new Set(
    [
      ...html.matchAll(
        /<script[^>]+src="([^"]+)"[^>]*>|<link[^>]+href="([^"]+\.js)"[^>]*as="script"/g,
      ),
    ]
      .filter((m) => !/noModule/i.test(m[0]))
      .map((m) => m[1] ?? m[2])
      .filter((src) => src.startsWith("/")),
  );
  let total = 0;
  for (const src of sources) {
    total += gzipSync(await (await page.request.get(src)).body()).length;
  }
  return total;
}

/** Records layout shifts from the first paint (installed before any page script runs). */
async function trackLayoutShifts(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __cls: number };
    w.__cls = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as (PerformanceEntry & {
        value: number;
        hadRecentInput: boolean;
      })[]) {
        if (!entry.hadRecentInput) w.__cls += entry.value;
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
}

/** CLS of a fresh load of `path`, once the page has settled. */
async function loadShift(page: Page, path: string): Promise<number> {
  await page.goto(path, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);
  return page.evaluate(() => (window as unknown as { __cls: number }).__cls);
}

/** Setup → Swipe → Review → Itinerary: the path of each step of one planned trip. */
async function tripPaths(page: Page): Promise<string[]> {
  await planRomeTrip(page);
  const base = new URL(page.url()).pathname.replace(/\/itinerary$/, "");
  return ["/", `${base}/swipe`, `${base}/review`, `${base}/itinerary`];
}

test("initial JavaScript stays under 200 KB gzipped on every page", async ({ page, isMobile }) => {
  test.skip(!isMobile, "The bundles are the same on desktop");
  for (const path of await tripPaths(page)) {
    const bytes = await initialJsBytes(page, path);
    expect(bytes, `${path}: ${(bytes / 1024).toFixed(1)} KB`).toBeLessThan(MAX_INITIAL_JS_GZIP);
  }
});

test("pages do not shift while loading on a slow CPU", async ({ page }) => {
  await serveBlankTiles(page);
  const paths = await tripPaths(page);
  await trackLayoutShifts(page);
  for (const path of paths) {
    const cls = await loadShift(page, path);
    expect(cls, `${path}: CLS ${cls.toFixed(3)}`).toBeLessThan(MAX_CLS);
  }
});
