import { expect, test, type Page } from "@playwright/test";
import { collectErrors, hydrated, planRomeTrip } from "./helpers";

/** Review → Itinerary on the seeded Rome pool (tests/e2e/seed.ts), fully offline (fake LLM). */

const dayList = (page: Page, day: number) =>
  page.getByRole("list", { name: `Day ${day} timeline` });

/** Name of the n-th stop of a day, read from its quick-action button. */
async function stopName(page: Page, day: number, index = 0) {
  const label = await dayList(page, day)
    .getByRole("button", { name: /^Change / })
    .nth(index)
    .getAttribute("aria-label");
  return label!.replace(/^Change /, "");
}

/** Runs a quick action and waits for its Server Action (the UI updates optimistically). */
async function quickAction(page: Page, place: string, action: string | RegExp) {
  await page.getByRole("button", { name: `Change ${place}` }).click();
  const saved = page.waitForResponse((r) => r.request().method() === "POST");
  await page.getByRole("menuitem", { name: action }).click();
  await saved;
}

test("generate an itinerary, edit it with quick actions and undo", async ({ page }) => {
  const errors = collectErrors(page);
  await planRomeTrip(page);

  await expect(page.getByText("AI-generated", { exact: true })).toBeVisible();
  await expect(page.getByRole("tab")).toHaveText(["Day 1", "Day 2"]);
  const day1 = dayList(page, 1);
  await expect(day1).toContainText("09:00");
  await expect(day1.getByText("Must-see")).toHaveCount(1);

  // F7: walking directions through the day's stops.
  const maps = page.getByRole("link", { name: "Open in Google Maps" });
  await expect(maps).toHaveAttribute(
    "href",
    /^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&.*travelmode=walking/,
  );

  // Remove → excluded with a reason, persisted.
  const removed = await stopName(page, 1);
  await quickAction(page, removed, "Remove from plan");
  const excluded = page.getByRole("region", { name: /Not in the plan/ });
  await expect(excluded).toContainText(removed);
  await expect(excluded).toContainText("Removed by you.");
  // Stops in the active day (the day may now be empty, without a timeline list).
  const stopsShown = (name: string) =>
    page.getByRole("tabpanel").getByRole("button", { name: `Change ${name}` });
  await expect(stopsShown(removed)).toHaveCount(0);
  await page.reload();
  await expect(excluded).toContainText(removed);
  await hydrated(page.getByRole("button", { name: "New plan" }));

  // Change day → the stop moves to the end of Day 2.
  const moved = await stopName(page, 1);
  await quickAction(page, moved, /^Day 2 ·/);
  await expect(page.getByText(`${moved} moved to Day 2.`)).toBeVisible();
  await expect(stopsShown(moved)).toHaveCount(0);
  await page.getByRole("tab", { name: "Day 2" }).click();
  await expect(dayList(page, 2).getByRole("listitem").last()).toContainText(moved);

  // Undo twice: back to the generated plan.
  await page.getByRole("button", { name: "Undo" }).click();
  await page.getByRole("tab", { name: "Day 1" }).click();
  await expect(day1).toContainText(moved);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(day1).toContainText(removed);
  await expect(page.getByRole("region", { name: /Not in the plan/ })).not.toContainText(removed);
  await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();

  // A new plan is a new, undoable version.
  await page.getByRole("button", { name: "New plan" }).click();
  await expect(page.getByText("Here's a new plan.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Undo" })).toBeEnabled();

  // The trip now opens on its itinerary.
  await page.goto(page.url().replace(/\/itinerary$/, ""));
  await expect(page).toHaveURL(/\/itinerary$/);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  expect(errors).toEqual([]);
});

test("the map shows the selected day's numbered stops", async ({ page, isMobile }) => {
  const errors = collectErrors(page);
  await planRomeTrip(page);
  await expect(dayList(page, 1)).toBeVisible();
  const stops = await dayList(page, 1)
    .getByRole("button", { name: /^Change / })
    .count();
  const first = await stopName(page, 1);

  const map = page.getByRole("region", { name: "Map of day 1" });
  if (isMobile) {
    // Mobile: the list comes first; the map (and Leaflet) only loads on request.
    await expect(map).toHaveCount(0);
    await page.getByRole("button", { name: "Map", exact: true }).click();
    await expect(dayList(page, 1)).toBeHidden();
  }
  await expect(map).toBeVisible();
  const markers = map.locator(".leaflet-marker-icon");
  await expect(markers).toHaveCount(stops);
  await expect(markers.first()).toHaveText("1");

  // Map → list sync: clicking a marker highlights its stop.
  await markers.first().click();
  if (isMobile) await page.getByRole("button", { name: "List", exact: true }).click();
  await expect(dayList(page, 1).getByRole("button", { name: `Stop 1: ${first}` })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(errors).toEqual([]);
});
