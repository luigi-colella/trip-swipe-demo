import { expect, test } from "@playwright/test";
import { chat, collectErrors, hydrated, openChat, planRomeTrip } from "./helpers";

/** F6 – The chat agent with the offline scripted model (LLM_MODE=fake). */

test("start a trip from the home chat, then shape the deck by chatting", async ({
  page,
  isMobile,
}) => {
  const errors = collectErrors(page);
  await page.goto("/");
  await openChat(page, isMobile);

  await chat(page, "Plan a trip to Rome for 2 days", /Created a trip to Rome, Italy: 2 days/);
  await expect(page).toHaveURL(/\/trip\/[0-9a-f-]{36}\/swipe$/);
  await expect(page.getByText("Place 1 of 8")).toBeVisible();
  // The conversation continues on the trip.
  const log = page.getByRole("log", { name: "Conversation" });
  await expect(log.getByText("Plan a trip to Rome for 2 days")).toBeVisible();

  await chat(page, "Add the Colosseum as a must-see", "Added Colosseum as a must-see.");
  await expect(page.getByText("1 in shortlist")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Colosseum" })).toHaveCount(0);

  // The conversation is kept on the server.
  await page.reload();
  await openChat(page, isMobile);
  await expect(log.getByText("Added Colosseum as a must-see.")).toBeVisible();
  expect(errors).toEqual([]);
});

test("edit the itinerary by chatting", async ({ page, isMobile }) => {
  const errors = collectErrors(page);
  await planRomeTrip(page);
  const day1 = page.getByRole("list", { name: "Day 1 timeline" });
  const first = (await day1
    .getByRole("button", { name: /^Change / })
    .first()
    .getAttribute("aria-label"))!.replace(/^Change /, "");

  await openChat(page, isMobile);
  await chat(page, `Move ${first} to day 2`, `Moved ${first} to Day 2.`);
  if (isMobile) await page.getByRole("button", { name: "Close chat" }).click();
  await expect(day1.getByRole("button", { name: `Change ${first}` })).toHaveCount(0);
  await page.getByRole("tab", { name: "Day 2" }).click();
  await expect(page.getByRole("list", { name: "Day 2 timeline" })).toContainText(first);

  await openChat(page, isMobile);
  await chat(page, `Remove ${first}`, `Removed ${first} from the itinerary.`);
  if (isMobile) await page.getByRole("button", { name: "Close chat" }).click();
  await expect(page.getByRole("region", { name: /Not in the plan/ })).toContainText(first);
  // Chat edits are versions like quick actions: undo brings the stop back.
  await hydrated(page.getByRole("button", { name: "Undo" }));
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByRole("region", { name: /Not in the plan/ })).not.toContainText(first);
  expect(errors).toEqual([]);
});
