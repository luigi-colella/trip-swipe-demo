/**
 * Screenshots of LangSmith for the README (docs/media/langsmith-*.png): a chat turn that calls
 * a tool, the itinerary planner graph and an eval experiment.
 *
 * Usage: npm run docs:langsmith   (needs LANGSMITH_API_KEY and LANGSMITH_AGENT_* in .env.local)
 *
 * 1. Finds the latest matching traces and experiment through the LangSmith API.
 * 2. When one is missing, offers to create it with live LLM requests. It asks every time,
 *    showing the cost and today's budget; nothing is spent without a "y".
 * 3. Opens each page in Chromium with a saved LangSmith session (data/langsmith-auth.json,
 *    gitignored). When there is none, or it expired, a browser window opens: sign in there and
 *    the script continues on its own.
 * 4. Saves the screenshots without personal details (account and workspace names cropped
 *    out, email addresses masked) and without product tips or account notices.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { awaitAllCallbacks } from "@langchain/core/callbacks/promises";
import { chromium, type Browser, type Page } from "@playwright/test";
import { Client } from "langsmith";
import { chatCase, createEvalContext, planTripCase, topPlaces } from "../evals/targets";
import { LlmBudget } from "../src/server/ai/budget";
import { openDatabase, runMigrations } from "../src/server/db/connection";
import { parseEnv, type Env } from "../src/server/env-schema";

const AUTH_FILE = "data/langsmith-auth.json";
const OUT_DIR = "docs/media";
const VIEWPORT = { width: 1440, height: 900 };
const LOGIN_TIMEOUT_MS = 10 * 60_000;
/** The city every generated trace uses (the one `npm run demo:record` needs too). */
const CITY = "Rome";

type Shot = {
  file: string;
  /** What the README shows. */
  title: string;
  /** The page to capture, or null when LangSmith has nothing to show yet. */
  find: () => Promise<string | null>;
  /** Creates the missing data with live requests (after the owner agreed). */
  generate: { cost: string; run: () => Promise<void> };
  /** Text that is on the page once it has loaded. */
  ready: string | RegExp;
};

async function main() {
  const env = parseEnv();
  if (!env.LANGSMITH_API_KEY || !env.LANGSMITH_AGENT_ID || !env.LANGSMITH_AGENT_ENVIRONMENT) {
    throw new Error("Set LANGSMITH_API_KEY and LANGSMITH_AGENT_* in .env.local (see README).");
  }
  const client = new Client();
  const projectName = `${env.LANGSMITH_AGENT_ID}-${env.LANGSMITH_AGENT_ENVIRONMENT}`;
  const host = client.getHostUrl();
  const { id: projectId } = await client.readProject({ projectName });
  /** Newest first; each run carries its page path in LangSmith. */
  const runs = (filter: string, extra: { is_root?: boolean; trace_id?: string } = {}) =>
    client.runs.query({
      project_ids: [projectId],
      filter,
      selects: ["ID", "TRACE_ID", "APP_PATH"],
      ...extra,
    });

  const shots: Shot[] = [
    {
      file: "langsmith-chat.png",
      title: "chat turn with a tool call",
      ready: "chat_agent",
      find: async () => {
        const turns = await runs('and(eq(name, "chat_agent"), eq(status, "success"))', {
          is_root: true,
        });
        for (const turn of turns.items) {
          const tool = await runs('and(eq(run_type, "tool"), eq(name, "add_place"))', {
            trace_id: turn.trace_id,
          });
          if (tool.items.length) return host + turn.app_path;
        }
        return null;
      },
      generate: {
        cost: "~2 requests (decide + reply)",
        run: () =>
          liveRun(env, "chat", async (ctx) => {
            const [, , , extra] = topPlaces(ctx.db, CITY, 4);
            const text = `Add ${extra.name} as a must-see`;
            await chatCase(ctx, { id: "docs", text, refuse: false, heuristic: false }, CITY);
          }),
      },
    },
    {
      file: "langsmith-planner.png",
      title: "itinerary planner graph",
      ready: "itinerary_planner",
      find: async () => {
        const plans = await runs('and(eq(name, "itinerary_planner"), eq(status, "success"))', {
          is_root: true,
        });
        return plans.items.length ? host + plans.items[0].app_path : null;
      },
      generate: {
        cost: "1–3 requests (plan, up to 2 repairs)",
        run: () =>
          liveRun(env, "planner", async (ctx) => {
            await planTripCase(ctx, {
              id: "docs",
              city: CITY,
              days: 2,
              pace: "balanced",
              places: 8,
              mustSee: 1,
            });
          }),
      },
    },
    {
      file: "langsmith-evals.png",
      title: "adversarial eval experiment",
      ready: /adversarial/,
      find: async () => {
        let latest: { url: string; start: number } | null = null;
        for await (const dataset of client.listDatasets({ datasetNameContains: "adversarial" })) {
          if (!dataset.name.startsWith("travelswipe-adversarial-")) continue;
          for await (const exp of client.listProjects({ referenceDatasetId: dataset.id })) {
            const start = new Date(exp.start_time).getTime();
            if (latest && latest.start >= start) continue;
            const datasetUrl = await client.getDatasetUrl({ datasetId: dataset.id });
            latest = {
              url: `${datasetUrl}/compare?selectedSessions=${exp.id}`,
              start,
            };
          }
        }
        return latest?.url ?? null;
      },
      generate: {
        cost: "~15–30 requests (npm run evals -- --suite adversarial)",
        run: async () => {
          const evals = spawnSync("npm run evals -- --suite adversarial", {
            stdio: "inherit",
            shell: true,
            env: { ...process.env, LLM_MODE: "live", LANGSMITH_TRACING: "true" },
          });
          if (evals.status !== 0) throw new Error("npm run evals failed");
        },
      },
    },
  ];

  const pages: { shot: Shot; url: string }[] = [];
  for (const shot of shots) {
    let url = await shot.find();
    if (!url) {
      console.log(`\nLangSmith has no ${shot.title} yet.`);
      if (await confirmSpend(env, shot.generate.cost)) {
        await shot.generate.run();
        url = await waitFor(shot.find);
      }
    }
    if (url) pages.push({ shot, url });
    else console.warn(`Skipped ${shot.file}.`);
  }
  if (pages.length === 0) return;

  const browser = await chromium.launch();
  try {
    await ensureSignedIn(browser, pages[0]);
    const context = await browser.newContext({ storageState: AUTH_FILE, viewport: VIEWPORT });
    const page = await context.newPage();
    for (const { shot, url } of pages) {
      await capture(page, url, shot);
      console.log(`Saved ${OUT_DIR}/${shot.file}`);
    }
  } finally {
    await browser.close();
  }
}

/** Asks before spending live requests; never in a non-interactive shell. */
async function confirmSpend(env: Env, cost: string): Promise<boolean> {
  if (!env.OPENROUTER_API_KEY) {
    console.log("OPENROUTER_API_KEY is not set: cannot create it.");
    return false;
  }
  const app = openDatabase(env.DATABASE_PATH);
  runMigrations(app.db);
  const budget = new LlmBudget(app.db, env.LLM_DAILY_BUDGET);
  const status = `LLM requests used today: ${budget.used()}/${budget.limit}`;
  app.sqlite.close();
  if (!process.stdin.isTTY) {
    console.log(`Not asking in a non-interactive shell (cost: ${cost}). ${status}`);
    return false;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(
    `Create it now with the live model? Cost: ${cost} of the free daily quota. ${status}. [y/N] `,
  );
  rl.close();
  return answer.trim().toLowerCase() === "y";
}

/** Runs workflows on a throwaway copy of the database, traced to the agent's project. */
async function liveRun(
  env: Env,
  label: string,
  body: (ctx: Awaited<ReturnType<typeof createEvalContext>>) => Promise<void>,
) {
  process.env.LANGSMITH_TRACING = "true";
  const liveEnv: Env = { ...env, LLM_MODE: "live", LANGSMITH_TRACING: "true" };
  const app = openDatabase(env.DATABASE_PATH);
  runMigrations(app.db);
  const budget = new LlmBudget(app.db, env.LLM_DAILY_BUDGET);
  const ctx = await createEvalContext(app.sqlite, liveEnv, budget);
  try {
    if (topPlaces(ctx.db, CITY, 4).length < 4) {
      throw new Error(`${CITY} is not seeded: npm run db:seed -- --cities ${CITY}`);
    }
    console.log(`Running the ${label} with the live model…`);
    await body(ctx);
  } finally {
    ctx.cleanup();
    console.log(`LLM requests used today: ${budget.used()}/${budget.limit}`);
    app.sqlite.close();
    await awaitAllCallbacks();
  }
}

/** New traces take a few seconds to show up in the API. */
async function waitFor(find: () => Promise<string | null>): Promise<string | null> {
  for (let i = 0; i < 12; i++) {
    const url = await find();
    if (url) return url;
    await new Promise((r) => setTimeout(r, 5000));
  }
  return null;
}

/**
 * Whether the page shows LangSmith's content or its sign-in form. The web app renders the form
 * at the requested URL itself (no redirect), so only the page content tells them apart.
 */
async function signInState(page: Page, ready: Shot["ready"], timeout: number) {
  const content = page.getByText(ready).first();
  const form = page.locator('input[type="password"]').first();
  try {
    await content.or(form).waitFor({ timeout });
  } catch {
    return "unknown";
  }
  return (await content.isVisible()) ? "signed-in" : "signed-out";
}

/** Reuses the saved session; otherwise lets the owner sign in once in a visible window. */
async function ensureSignedIn(browser: Browser, probe: { shot: Shot; url: string }) {
  if (existsSync(AUTH_FILE)) {
    const context = await browser.newContext({ storageState: AUTH_FILE });
    const page = await context.newPage();
    await page.goto(probe.url);
    const state = await signInState(page, probe.shot.ready, 60_000);
    await context.close();
    if (state === "signed-in") return;
    console.log("The saved LangSmith session has expired.");
  }
  console.log("Log in to LangSmith in the browser window that just opened (tab 'Log In')…");
  const headed = await chromium.launch({ headless: false });
  try {
    const context = await headed.newContext({ viewport: VIEWPORT });
    const page = await context.newPage();
    await page.goto(probe.url);
    // Signed in once the requested page shows its content. After the sign-in (and any SSO
    // round trip, left alone) LangSmith may land on its home page: open the page again then.
    const deadline = Date.now() + LOGIN_TIMEOUT_MS;
    while ((await signInState(page, probe.shot.ready, 5000)) !== "signed-in") {
      if (Date.now() > deadline) throw new Error("Timed out waiting for the LangSmith sign-in.");
      const onForm = await page.locator('input[type="password"]').first().isVisible();
      const here = new URL(page.url());
      const target = new URL(probe.url);
      const elsewhere = here.origin === target.origin && here.pathname !== target.pathname;
      if (elsewhere && !onForm) await page.goto(probe.url);
    }
    await context.storageState({ path: AUTH_FILE, indexedDB: true });
    console.log(`Session saved to ${AUTH_FILE} (gitignored).`);
  } finally {
    await headed.close();
  }
}

/**
 * Leaves only the content: product tips are dismissed, account notices (e.g. API key
 * migrations) are hidden in the page only, and the left sidebar, which shows the account and
 * workspace names, is cropped out. Email addresses left anywhere are masked.
 */
async function tidy(page: Page) {
  for (const tip of await page.getByRole("button", { name: "Got it" }).all()) {
    if (await tip.isVisible()) await tip.click();
  }
  // The page keeps its height without the notice: the freed strip at the bottom is cropped.
  const hidden = await page.evaluate(() => {
    let height = 0;
    const width = document.documentElement.clientWidth;
    for (const el of document.querySelectorAll("button")) {
      if (!/how to migrate|view org usage/i.test(el.textContent ?? "")) continue;
      let banner: HTMLElement | null = el;
      while (banner && banner.getBoundingClientRect().width < width * 0.6) {
        banner = banner.parentElement;
      }
      const box = banner?.getBoundingClientRect();
      if (banner && box && box.height < 150) {
        banner.style.display = "none";
        height += box.height;
      }
    }
    return height;
  });
  // Keep hover cards out of the picture.
  await page.mouse.move(VIEWPORT.width - 1, VIEWPORT.height - 1);
  const sidebar = await page.locator("header").first().boundingBox();
  const left = sidebar && sidebar.x === 0 && sidebar.width < VIEWPORT.width / 3 ? sidebar.width : 0;
  return {
    x: left,
    y: 0,
    width: VIEWPORT.width - left,
    height: VIEWPORT.height - Math.ceil(hidden),
  };
}

async function capture(page: Page, url: string, shot: Shot) {
  await page.goto(url);
  await page.getByText(shot.ready).first().waitFor({ timeout: 60_000 });
  // Panels and charts load after the title; LangSmith keeps polling, so no networkidle.
  await page.waitForTimeout(4000);
  const clip = await tidy(page);
  await page.waitForTimeout(500);
  await page.screenshot({
    path: `${OUT_DIR}/${shot.file}`,
    clip,
    mask: [page.getByText(/@[w-]+.[a-z]{2,}/i)],
    animations: "disabled",
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
