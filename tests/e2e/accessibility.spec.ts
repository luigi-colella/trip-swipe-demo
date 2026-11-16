import AxeBuilder from "@axe-core/playwright";
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
 * Automated accessibility checks (axe-core, WCAG 2.1 A/AA) on every screen and state, mobile
 * and desktop. They catch what can be computed (contrast, names, roles, structure); keyboard
 * use and focus order are covered by the flow tests.
 */

async function expectAccessible(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(
    violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`),
  ).toEqual([]);
}

test("setup", async ({ page }) => {
  await page.goto("/");
  await hydrated(page.getByRole("combobox", { name: "City" }));
  await expectAccessible(page);
  await page.getByRole("combobox", { name: "City" }).fill("Rome");
  await expect(page.getByRole("option")).toHaveCount(2);
  await expectAccessible(page);
});

test("swipe and review", async ({ page }) => {
  await createRomeTrip(page);
  await expectAccessible(page);
  await likeEverything(page);
  await expect(page.getByRole("button", { name: "Load more" })).toBeVisible();
  await expectAccessible(page);
  await page.getByRole("button", { name: /Review shortlist/ }).click();
  await expect(page.getByRole("list", { name: "Shortlist" })).toBeVisible();
  await expectAccessible(page);
});

test("itinerary", async ({ page, isMobile }) => {
  await planRomeTrip(page);
  await expect(page.getByRole("list", { name: "Day 1 timeline" })).toBeVisible();
  await expectAccessible(page);
  if (isMobile) {
    await page.getByRole("button", { name: "Map", exact: true }).click();
    await expect(page.locator(".leaflet-marker-icon").first()).toBeVisible();
    await expectAccessible(page);
  }
});

test("chat", async ({ page, isMobile }) => {
  await page.goto("/");
  await openChat(page, isMobile);
  await expectAccessible(page);
  await chat(page, "Plan a trip to Rome for 2 days", /Created a trip to Rome/);
  await expectAccessible(page);
});

test("not found", async ({ page }) => {
  await serveBlankTiles(page);
  await page.goto("/trip/00000000-0000-4000-8000-000000000000/swipe");
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  await expectAccessible(page);
});

test.describe("AI is busy", () => {
  test.use({ baseURL: BUSY_URL });

  test("banner and paused discovery", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("status").filter({ hasText: "AI is busy." })).toBeVisible();
    await expectAccessible(page);
    await hydrated(page.getByRole("combobox", { name: "City" }));
    await page.getByRole("combobox", { name: "City" }).fill("Paris");
    await page.getByRole("option", { name: /Paris, Ile-de-France, France/ }).click();
    await page.getByRole("button", { name: "Start swiping" }).click();
    await expect(page.getByRole("heading", { name: "AI is busy" })).toBeVisible();
    await expectAccessible(page);
  });
});
