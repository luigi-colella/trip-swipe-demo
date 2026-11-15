import { expect, test } from "@playwright/test";

test("health endpoint reports a working database in fake LLM mode", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.ok()).toBe(true);
  const body = await res.json();
  expect(body).toMatchObject({ status: "ok", llmMode: "fake" });
  expect(body.tables).toBeGreaterThanOrEqual(10);
});

test("home page renders without errors or horizontal overflow", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  page.on("console", (msg) => msg.type() === "error" && errors.push(msg.text()));

  const res = await page.goto("/");
  expect(res?.ok()).toBe(true);
  await expect(page.locator("body")).toBeVisible();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  expect(errors).toEqual([]);
});
