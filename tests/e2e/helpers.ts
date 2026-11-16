import { expect, type Locator, type Page } from "@playwright/test";

/** Shared steps for the E2E specs (seeded Rome pool, fake LLM, no network). */

/**
 * 1×1 light grey PNG: map tiles are served locally, so the browser never hits the network and
 * screenshots do not depend on OpenStreetMap's tiles of the day.
 */
const TILE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGN48+4jAAWVAswF/XNjAAAAAElFTkSuQmCC",
  "base64",
);

export function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  page.on("console", (msg) => msg.type() === "error" && errors.push(msg.text()));
  return errors;
}

export async function serveBlankTiles(page: Page) {
  await page.route("https://tile.openstreetmap.org/**", (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: TILE }),
  );
}

/**
 * Waits until React has hydrated an element (it then carries React's props). Server-rendered
 * pages are visible before their event handlers exist: input sent earlier is silently lost,
 * which makes tests flaky on a busy machine.
 */
export async function hydrated(locator: Locator) {
  await expect
    .poll(() => locator.evaluate((el) => Object.keys(el).some((k) => k.startsWith("__reactProps"))))
    .toBe(true);
}

/** Setup → Swipe: a 2-day relaxed Rome trip, on its first card. */
export async function createRomeTrip(page: Page) {
  await page.goto("/");
  await hydrated(page.getByRole("combobox", { name: "City" }));
  await page.getByRole("combobox", { name: "City" }).fill("Rome");
  await page.getByRole("option", { name: /Rome, Lazio, Italy/ }).click();
  await page.getByText("2", { exact: true }).click();
  await page.getByText("Relaxed").click();
  await page.getByRole("button", { name: "Start swiping" }).click();
  await expect(page.getByText("Place 1 of 8")).toBeVisible();
  await hydrated(page.getByRole("button", { name: "Like", exact: true }));
}

/** Swipe: one must-see, then like the other 7 places. */
export async function likeEverything(page: Page) {
  await page.keyboard.press("ArrowUp");
  await expect(page.getByText("1 in shortlist")).toBeVisible();
  for (let n = 2; n <= 8; n++) {
    await page.keyboard.press("ArrowRight");
    await expect(page.getByText(`${n} in shortlist`)).toBeVisible();
  }
}

/** Setup → Swipe → Review → Itinerary. */
export async function planRomeTrip(page: Page) {
  await serveBlankTiles(page);
  await createRomeTrip(page);
  await likeEverything(page);
  await page.getByRole("button", { name: /Review shortlist/ }).click();
  await expect(page).toHaveURL(/\/review$/);
  await hydrated(page.getByRole("button", { name: "Generate itinerary" }));
  await page.getByRole("button", { name: "Generate itinerary" }).click();
  await expect(page).toHaveURL(/\/trip\/[0-9a-f-]{36}\/itinerary$/);
  await hydrated(page.getByRole("button", { name: "New plan" }));
  // The stops' quick-action menus hydrate once their code has loaded (after the page).
  await hydrated(page.getByRole("button", { name: /^Change / }).first());
}

/** F6: the chat is a pane on desktop and a bottom sheet (opened from a button) on mobile. */
export async function openChat(page: Page, isMobile: boolean) {
  if (isMobile) {
    const open = page.getByRole("button", { name: "Open the trip assistant" });
    await hydrated(open);
    await open.click();
  }
  const input = page.getByRole("textbox", { name: "Message" });
  await hydrated(input);
  return input;
}

/** Sends a chat message and waits for the streamed reply. */
export async function chat(page: Page, message: string, reply: string | RegExp) {
  await page.getByRole("textbox", { name: "Message" }).fill(message);
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("log", { name: "Conversation" }).getByText(reply)).toBeVisible();
}
