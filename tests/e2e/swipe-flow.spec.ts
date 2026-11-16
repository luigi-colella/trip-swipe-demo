import { expect, test, type Page } from "@playwright/test";

/** Setup → Swipe → Review on the seeded Rome pool (tests/e2e/seed.ts), fully offline. */

async function createRomeTrip(page: Page) {
  await page.goto("/");
  await page.getByRole("combobox", { name: "City" }).fill("Rome");
  await page.getByRole("option", { name: /Rome, Lazio, Italy/ }).click();
  await page.getByText("2", { exact: true }).click();
  await page.getByText("Relaxed").click();
  await page.getByText("Art", { exact: true }).click();
  await page.getByRole("button", { name: "Start swiping" }).click();
  await expect(page).toHaveURL(/\/trip\/[0-9a-f-]{36}\/swipe$/);
  await expect(page.getByRole("heading", { level: 1, name: "Rome" })).toBeVisible();
}

const topCardTitle = (page: Page) =>
  page.locator('[aria-roledescription="card stack"] > div:not([aria-hidden]) h2');

function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  page.on("console", (msg) => msg.type() === "error" && errors.push(msg.text()));
  return errors;
}

test("setup requires a city from the suggestions", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Start swiping" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Pick a city from the suggestions." }),
  ).toBeVisible();
  await expect(page).toHaveURL("/");
});

test("swipe with buttons, keyboard and drag, undo, then review the shortlist", async ({ page }) => {
  const errors = collectErrors(page);
  await createRomeTrip(page);
  await expect(page.getByText("2 days · Relaxed")).toBeVisible();
  await expect(page.getByText("Place 1 of 8")).toBeVisible();

  const reviewButton = page.getByRole("button", { name: /Review shortlist/ });
  await expect(reviewButton).toBeDisabled();

  // Like with the button.
  const first = await topCardTitle(page).textContent();
  await page.getByRole("button", { name: "Like", exact: true }).click();
  await expect(page.getByText("Place 2 of 8")).toBeVisible();
  await expect(page.getByText("1 in shortlist")).toBeVisible();

  // Skip with the keyboard, then undo it.
  const second = await topCardTitle(page).textContent();
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByText("Place 3 of 8")).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText("Place 2 of 8")).toBeVisible();
  await expect(topCardTitle(page)).toHaveText(second!);

  // Must-see by dragging the card upwards.
  const box = (await page.locator('[aria-roledescription="card stack"]').boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 3;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y - 80, { steps: 5 });
  await page.mouse.move(x, y - 200, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByText("Place 3 of 8")).toBeVisible();
  await expect(page.getByText("2 in shortlist")).toBeVisible();

  // Decisions survive a reload (persisted by the Server Actions).
  await page.reload();
  await expect(page.getByText("Place 3 of 8")).toBeVisible();

  await reviewButton.click();
  await expect(page).toHaveURL(/\/review$/);
  const items = page.getByRole("list", { name: "Shortlist" }).getByRole("listitem");
  await expect(items).toHaveCount(2);
  // Must-see first.
  await expect(items.first()).toContainText(second!);
  await expect(items.first()).toContainText("Must-see");
  await expect(items.nth(1)).toContainText(first!);

  // Promote the liked place, then remove the other one.
  await page.getByRole("button", { name: `Mark ${first} as must-see` }).click();
  await expect(page.getByText("2 places · 2 must-see")).toBeVisible();
  await page.getByRole("button", { name: `Remove ${second}` }).click();
  await expect(items).toHaveCount(1);

  await page.reload();
  await expect(items).toHaveCount(1);
  await expect(items.first()).toContainText(first!);
  await expect(page.getByRole("button", { name: "Generate itinerary" })).toBeDisabled();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  expect(errors).toEqual([]);
});

test("an unknown trip shows the not-found page", async ({ page }) => {
  await page.goto("/trip/00000000-0000-4000-8000-000000000000/swipe");
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
});
