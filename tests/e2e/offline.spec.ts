import { expect, test, type Page } from "@playwright/test";
import { createRomeTrip, hydrated, likeEverything, planRomeTrip } from "./helpers";

/**
 * Lost connection (defensive programming, AGENTS.md): a request that never gets an answer, or
 * code that cannot be downloaded, is explained where it happened; the page stays usable.
 * Regressions: these used to replace the whole page with an error screen.
 */

const CONNECTION_ERROR = "Couldn't reach the server. Check your connection and try again.";

/** Requests started and not finished yet, per page. */
const inFlight = new WeakMap<Page, Set<unknown>>();

test.beforeEach(({ page }) => {
  const pending = new Set<unknown>();
  inFlight.set(page, pending);
  page.on("request", (request) => pending.add(request));
  page.on("requestfinished", (request) => pending.delete(request));
  page.on("requestfailed", (request) => pending.delete(request));
});

/**
 * Goes offline once the page is quiet: the last swipe saved, the code fetched after loading
 * (notifications) arrived. `waitForLoadState("networkidle")` is no help here: it resolves at
 * once when the page was idle earlier, even with a request in flight now, and going offline
 * then fails that request (a swipe the test expects saved is rolled back).
 */
async function goOffline(page: Page) {
  const pending = inFlight.get(page)!;
  for (let quiet = 0; quiet < 5; quiet = pending.size === 0 ? quiet + 1 : 0) {
    await page.waitForTimeout(100);
  }
  await page.context().setOffline(true);
}

test("setup explains a lost connection instead of crashing", async ({ page }) => {
  await page.goto("/");
  await hydrated(page.getByRole("combobox", { name: "City" }));
  await page.getByRole("combobox", { name: "City" }).fill("Rome");
  await page.getByRole("option", { name: /Rome, Lazio, Italy/ }).click();
  await goOffline(page);
  await page.getByRole("button", { name: "Start swiping" }).click();
  await expect(page.getByRole("alert").filter({ hasText: CONNECTION_ERROR })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start swiping" })).toBeEnabled();
});

test("swipe and review keep the page when the connection drops", async ({ page }) => {
  await createRomeTrip(page);
  await likeEverything(page);
  await goOffline(page);
  await page.getByRole("button", { name: /Review shortlist/ }).click();
  await expect(page.getByText(CONNECTION_ERROR)).toBeVisible();
  await expect(page.getByText("8 in shortlist")).toBeVisible();

  await page.context().setOffline(false);
  // The toast outlives the navigation: let it go so the next one is told apart.
  await expect(page.getByText(CONNECTION_ERROR)).toBeHidden({ timeout: 10_000 });
  await page.getByRole("button", { name: /Review shortlist/ }).click();
  await expect(page).toHaveURL(/\/review$/);
  const generate = page.getByRole("button", { name: "Generate itinerary" });
  await hydrated(generate);
  await goOffline(page);
  await page
    .getByRole("button", { name: /^Remove / })
    .first()
    .click();
  await expect(page.getByText(/^Couldn't update .+\. Please try again\.$/)).toBeVisible();
  await generate.click();
  await expect(page.getByText(CONNECTION_ERROR)).toBeVisible();
  await expect(page.getByRole("list", { name: "Shortlist" }).getByRole("listitem")).toHaveCount(8);
});

test("the itinerary keeps working offline, explaining what cannot load", async ({
  page,
  isMobile,
}) => {
  await planRomeTrip(page);
  await goOffline(page);
  const first = page.getByRole("button", { name: /^Change / }).first();
  const place = (await first.getAttribute("aria-label"))!.replace(/^Change /, "");
  await first.click();
  await page.getByRole("menuitem", { name: "Remove from plan" }).click();
  await expect(page.getByText(`Couldn't change ${place}: ${CONNECTION_ERROR}`)).toBeVisible();
  await expect(page.getByRole("button", { name: `Change ${place}` })).toBeVisible();

  // On mobile the map and the assistant load on demand: their code is not there offline.
  test.skip(!isMobile, "On desktop the map and the assistant load with the page");
  await page.getByRole("button", { name: "Map", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Couldn't load the map." })).toBeVisible();
  await page.getByRole("button", { name: "Open the trip assistant" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Couldn't load the assistant." }),
  ).toBeVisible();
  await expect(page.getByRole("tab", { name: "Day 1" })).toBeVisible();
});
