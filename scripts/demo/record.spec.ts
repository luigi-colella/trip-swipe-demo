import { expect, test, type Page } from "@playwright/test";
import { hydrated } from "../../tests/e2e/helpers";

/**
 * The demo script: Setup → Swipe → Review → Itinerary → chat edit, paced for a viewer.
 * Not part of the test suites (see scripts/demo/playwright.config.ts).
 */

/** Gives the viewer time to read the screen. */
const pause = (page: Page, ms = 1200) => page.waitForTimeout(ms);

/** Waits for the visible cards' photos, so the video never shows a half-loaded image. */
async function photosLoaded(page: Page) {
  // Commons can be slow to serve the first thumbnails.
  await expect
    .poll(
      () =>
        page
          .getByRole("group", { name: "Places to swipe" })
          .locator("img")
          .evaluateAll((imgs) => imgs.every((img) => (img as HTMLImageElement).complete)),
      { timeout: 30_000 },
    )
    .toBe(true);
}

/** Drags the top card like a finger would: right = like, left = skip. */
async function dragCard(page: Page, direction: 1 | -1) {
  await photosLoaded(page);
  const box = (await page.getByRole("group", { name: "Places to swipe" }).boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + direction * 260, y - 30, { steps: 25 });
  await page.mouse.up();
  await pause(page, 900);
}

test("demo", async ({ page }) => {
  // Setup: Rome, 2 days, balanced pace.
  await page.goto("/");
  const city = page.getByRole("combobox", { name: "City" });
  await hydrated(city);
  await pause(page, 800);
  await city.pressSequentially("Rome", { delay: 120 });
  await page.getByRole("option", { name: /Rome, Lazio, Italy/ }).click();
  await pause(page, 500);
  await page.getByText("2", { exact: true }).click();
  await page.getByText("Balanced").click();
  await pause(page, 800);
  await page.getByRole("button", { name: "Start swiping" }).click();

  // Swipe: drag a few cards, then use the keyboard (★ = must-see).
  await expect(page.getByText(/Place 1 of \d+/)).toBeVisible();
  await hydrated(page.getByRole("button", { name: "Like", exact: true }));
  await pause(page, 1500);
  await dragCard(page, 1);
  await dragCard(page, 1);
  await dragCard(page, -1);
  for (const key of ["ArrowUp", "ArrowRight", "ArrowRight", "ArrowLeft", "ArrowRight"]) {
    await photosLoaded(page);
    await page.keyboard.press(key);
    await pause(page, 700);
  }
  await expect(page.getByText("6 in shortlist")).toBeVisible();
  await pause(page);

  // Review the shortlist, then plan.
  await page.getByRole("button", { name: /Review shortlist/ }).click();
  await expect(page).toHaveURL(/\/review$/);
  const generate = page.getByRole("button", { name: "Generate itinerary" });
  await hydrated(generate);
  await pause(page, 2000);
  await generate.click();

  // Itinerary: timeline and map, then day 2.
  await expect(page).toHaveURL(/\/itinerary$/);
  await hydrated(page.getByRole("button", { name: "New plan" }));
  await expect(page.locator(".leaflet-marker-icon").first()).toBeVisible();
  await pause(page, 3000);
  await page.getByRole("tab", { name: "Day 2" }).click();
  await pause(page, 2500);
  await page.getByRole("tab", { name: "Day 1" }).click();
  await pause(page, 1000);

  // Chat: move the first stop of day 1 to day 2; the plan updates at once.
  const first = (await page
    .getByRole("list", { name: "Day 1 timeline" })
    .getByRole("button", { name: /^Change / })
    .first()
    .getAttribute("aria-label"))!.replace(/^Change /, "");
  const input = page.getByRole("textbox", { name: "Message" });
  await hydrated(input);
  await input.pressSequentially(`Move ${first} to day 2`, { delay: 60 });
  await pause(page, 500);
  await page.getByRole("button", { name: "Send" }).click();
  await expect(
    page.getByRole("log", { name: "Conversation" }).getByText(`Moved ${first} to Day 2.`),
  ).toBeVisible();
  await pause(page, 1500);
  await page.getByRole("tab", { name: "Day 2" }).click();
  await expect(page.getByRole("list", { name: "Day 2 timeline" })).toContainText(first);
  await pause(page, 3000);
});
