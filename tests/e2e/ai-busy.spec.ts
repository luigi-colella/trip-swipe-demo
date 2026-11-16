import { expect, test, type Page } from "@playwright/test";
import {
  collectErrors,
  createRomeTrip,
  hydrated,
  likeEverything,
  openChat,
  serveBlankTiles,
} from "./helpers";
import { BUSY_URL } from "./servers";

/**
 * "AI is busy" (§7, LLM10): against the server whose daily LLM budget is 0. Everything that
 * does not need the model keeps working; the rest says why it is paused.
 */
test.use({ baseURL: BUSY_URL });

const PAUSED = /Today's free AI quota is used up/;

async function startTrip(page: Page, city: "Rome" | "Paris", suggestion: RegExp) {
  await page.goto("/");
  await hydrated(page.getByRole("combobox", { name: "City" }));
  await page.getByRole("combobox", { name: "City" }).fill(city);
  await page.getByRole("option", { name: suggestion }).click();
  await page.getByRole("button", { name: "Start swiping" }).click();
}

test("the banner explains the pause; saved cities and planning by rules still work", async ({
  page,
}) => {
  const errors = collectErrors(page);
  await serveBlankTiles(page);
  await page.goto("/");
  await expect(page.getByRole("status").filter({ hasText: "AI is busy." })).toContainText(PAUSED);

  await createRomeTrip(page);
  await likeEverything(page);
  await page.getByRole("button", { name: /Review shortlist/ }).click();
  await hydrated(page.getByRole("button", { name: "Generate itinerary" }));
  await page.getByRole("button", { name: "Generate itinerary" }).click();
  await expect(page).toHaveURL(/\/itinerary$/);
  await expect(page.getByText("Planned by rules")).toBeVisible();
  expect(errors).toEqual([]);
});

test("a city without places waits for the AI, with a retry", async ({ page }) => {
  const errors = collectErrors(page);
  await startTrip(page, "Paris", /Paris, Ile-de-France, France/);
  await expect(page).toHaveURL(/\/swipe$/);
  await expect(page.getByRole("heading", { name: "AI is busy" })).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "AI is busy" })).toContainText(PAUSED);
  await expect(page.getByRole("link", { name: "New trip" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("the chat says the AI is paused", async ({ page, isMobile }) => {
  await page.goto("/");
  await openChat(page, isMobile);
  await page.getByRole("textbox", { name: "Message" }).fill("Plan a trip to Rome for 2 days");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("log", { name: "Conversation" }).getByRole("alert")).toContainText(
    PAUSED,
  );
});
