import { expect, test, type Page } from "@playwright/test";
import { createSiracusaTrip, hydrated, openChat, planRomeTrip } from "./helpers";

/**
 * Visual QA sizes (§2): every step fits 320×568, 360×640, 390×844, 768 and 1280+ without horizontal
 * scrolling or content cut at the right edge. Screenshot tests cover the look on two sizes;
 * this covers the layout on all five.
 */

const SIZES = [
  { width: 320, height: 568 },
  { width: 360, height: 640 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1280, height: 800 },
];

async function expectNoHorizontalOverflow(page: Page, label: string) {
  const overflow = await page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const wide = [...document.querySelectorAll("body *")].filter((el) => {
      const r = el.getBoundingClientRect();
      // Off-canvas and hidden elements (zero size) do not count.
      return r.width > 0 && r.height > 0 && r.right > width + 1;
    });
    return {
      scroll: document.documentElement.scrollWidth - width,
      elements: wide.slice(0, 3).map((el) => `${el.tagName.toLowerCase()}.${el.className}`),
    };
  });
  expect(overflow, label).toEqual({ scroll: 0, elements: [] });
}

test("every step fits each QA size", async ({ page, isMobile }) => {
  test.skip(isMobile, "Sizes are set explicitly; one project is enough");
  await planRomeTrip(page);
  const base = new URL(page.url()).pathname.replace(/\/itinerary$/, "");
  for (const size of SIZES) {
    await page.setViewportSize(size);
    for (const path of ["/", `${base}/swipe`, `${base}/review`, `${base}/itinerary`]) {
      await page.goto(path);
      // Trip pages stream in: measure the real header, not its skeleton.
      if (path !== "/") await page.getByRole("navigation", { name: "Trip progress" }).waitFor();
      await page.evaluate(() => document.fonts.ready);
      await expectNoHorizontalOverflow(page, `${path} at ${size.width}×${size.height}`);
    }
    await page.goto("/");
    await openChat(page, size.width < 1024);
    await hydrated(page.getByRole("textbox", { name: "Message" }));
    await expectNoHorizontalOverflow(page, `chat at ${size.width}×${size.height}`);
  }
});

test("the no-attractions state fits each QA size", async ({ page, isMobile }) => {
  test.skip(isMobile, "Sizes are set explicitly; one project is enough");
  await createSiracusaTrip(page);
  const path = new URL(page.url()).pathname;
  const heading = page.getByRole("heading", { name: "No attractions found for Siracusa" });
  for (const size of SIZES) {
    await page.setViewportSize(size);
    await page.goto(path);
    await heading.waitFor();
    await page.evaluate(() => document.fonts.ready);
    await expectNoHorizontalOverflow(page, `no attractions at ${size.width}×${size.height}`);
  }
});
