import { expect, test, type Page } from "@playwright/test";
import {
  chat,
  createRomeTrip,
  hydrated,
  likeEverything,
  openChat,
  planRomeTrip,
  serveBlankTiles,
} from "./helpers";
import { BUSY_URL } from "./servers";

/**
 * Screenshot tests: each key screen is compared with a reference image (mobile and desktop).
 * Reference images exist for Windows only for now; on other platforms the comparisons are
 * skipped (`ignoreSnapshots` in playwright.config.ts). After an intended UI change, run
 * `npm run test:e2e:update-screenshots` and review the new images before committing them.
 */

async function snap(page: Page, name: string) {
  // On desktop the chat pane loads its code after hydration: wait until it is ready.
  if (page.viewportSize()!.width >= 1024) {
    await expect(page.getByRole("textbox", { name: "Message" })).toBeVisible();
  }
  // Web fonts must be loaded, or text metrics differ between runs.
  await page.evaluate(() => document.fonts.ready);
  await expect(page).toHaveScreenshot(`${name}.png`, { fullPage: true });
}

test("setup", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Start swiping" })).toBeVisible();
  await snap(page, "setup");
});

test("setup with city suggestions", async ({ page }) => {
  await page.goto("/");
  await hydrated(page.getByRole("combobox", { name: "City" }));
  await page.getByRole("combobox", { name: "City" }).fill("Rome");
  await expect(page.getByRole("option")).toHaveCount(2);
  await snap(page, "setup-suggestions");
});

test("swipe deck", async ({ page }) => {
  await createRomeTrip(page);
  await snap(page, "swipe");
});

test("swipe deck when every place was seen", async ({ page }) => {
  await createRomeTrip(page);
  await likeEverything(page);
  await expect(page.getByRole("button", { name: "Load more" })).toBeVisible();
  await snap(page, "swipe-done");
});

test("review", async ({ page }) => {
  await createRomeTrip(page);
  await likeEverything(page);
  await page.getByRole("button", { name: /Review shortlist/ }).click();
  await expect(page.getByRole("list", { name: "Shortlist" })).toBeVisible();
  await hydrated(page.getByRole("button", { name: "Generate itinerary" }));
  await snap(page, "review");
});

test("itinerary", async ({ page, isMobile }) => {
  await planRomeTrip(page);
  await expect(page.getByRole("list", { name: "Day 1 timeline" })).toBeVisible();
  if (!isMobile) {
    await expect(page.locator(".leaflet-marker-icon").first()).toBeVisible();
  }
  await snap(page, "itinerary");

  await page.getByRole("tab", { name: "Day 2" }).click();
  await expect(page.getByRole("list", { name: "Day 2 timeline" })).toBeVisible();
  await snap(page, "itinerary-day-2");
});

test("itinerary map on mobile", async ({ page, isMobile }) => {
  test.skip(!isMobile, "The map is always visible on desktop");
  await planRomeTrip(page);
  await page.getByRole("button", { name: "Map", exact: true }).click();
  await expect(page.locator(".leaflet-marker-icon").first()).toBeVisible();
  await snap(page, "itinerary-map");
});

test("itinerary offline on mobile: the map and the assistant cannot load", async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, "On desktop both load with the page, so they are there offline");
  await planRomeTrip(page);
  await page.waitForLoadState("networkidle");
  await page.context().setOffline(true);
  await page.getByRole("button", { name: "Map", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Couldn't load the map." })).toBeVisible();
  await snap(page, "offline-map");
  await page.getByRole("button", { name: "Open the trip assistant" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Couldn't load the assistant." }),
  ).toBeVisible();
  await snap(page, "offline-assistant");
});

test("itinerary quick actions menu", async ({ page }) => {
  await planRomeTrip(page);
  await page
    .getByRole("list", { name: "Day 1 timeline" })
    .getByRole("button", { name: /^Change / })
    .first()
    .click();
  await expect(page.getByRole("menuitem", { name: "Remove from plan" })).toBeVisible();
  await expect(page).toHaveScreenshot("itinerary-menu.png");
});

test("not found", async ({ page }) => {
  await serveBlankTiles(page);
  await page.goto("/trip/00000000-0000-4000-8000-000000000000/swipe");
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  await snap(page, "not-found");
});

test("chat on the home page", async ({ page, isMobile }) => {
  await page.goto("/");
  await openChat(page, isMobile);
  await expect(page.getByRole("button", { name: "Plan a trip to Rome for 3 days" })).toBeVisible();
  await snap(page, "chat-home");
});

test("chat conversation", async ({ page, isMobile }) => {
  await page.goto("/");
  await openChat(page, isMobile);
  await chat(page, "Plan a trip to Rome for 2 days", /Created a trip to Rome/);
  await expect(page.getByText("Place 1 of 8")).toBeVisible();
  await chat(page, "Add the Colosseum", "Added Colosseum to the shortlist.");
  await expect(page.getByText("1 in shortlist")).toBeVisible();
  await snap(page, "chat-conversation");
});

test.describe("AI is busy", () => {
  test.use({ baseURL: BUSY_URL });

  test("banner on the setup page", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("status").filter({ hasText: "AI is busy." })).toBeVisible();
    await expect(page.getByRole("button", { name: "Start swiping" })).toBeVisible();
    await snap(page, "ai-busy-setup");
  });

  test("a new city waits for the AI", async ({ page }) => {
    await page.goto("/");
    await hydrated(page.getByRole("combobox", { name: "City" }));
    await page.getByRole("combobox", { name: "City" }).fill("Paris");
    await page.getByRole("option", { name: /Paris, Ile-de-France, France/ }).click();
    await page.getByRole("button", { name: "Start swiping" }).click();
    await expect(page.getByRole("heading", { name: "AI is busy" })).toBeVisible();
    await snap(page, "ai-busy-swipe");
  });
});
