import { defineConfig, devices } from "@playwright/test";
import { BUSY_PORT, MAIN_PORT } from "./tests/e2e/servers";

/** A production server with its own throwaway database, seeded with the offline fixtures. */
function server(port: number, database: string, env: Record<string, string> = {}) {
  return {
    command: `npm run db:migrate && node --import tsx tests/e2e/seed.ts && npx next start -p ${port}`,
    url: `http://localhost:${port}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      LLM_MODE: "fake",
      DATABASE_PATH: database,
      // Every test comes from the same address: per-client limits must not get in the way.
      RATE_LIMIT_CHAT_PER_HOUR: "10000",
      RATE_LIMIT_CHAT_PER_TRIP_PER_DAY: "10000",
      RATE_LIMIT_AI_ACTIONS_PER_HOUR: "10000",
      ...env,
    },
  };
}

/**
 * E2E tests run against the production build (`npm run build` first) with a throwaway
 * database and the offline fake LLM, so they never consume provider quota. tests/e2e/seed.ts
 * pre-fills the Photon cache and the Rome place pool, so the server never needs the network.
 * A second server has a daily LLM budget of 0, for the "AI is busy" flows (tests/e2e/servers.ts).
 */
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  // Screenshot tests (tests/e2e/visual.spec.ts): reference images exist for Windows only for
  // now, so the comparisons are skipped elsewhere (including Linux CI).
  ignoreSnapshots: process.platform !== "win32",
  snapshotPathTemplate:
    "{testDir}/__screenshots__/{testFileName}/{arg}-{projectName}-{platform}{ext}",
  expect: {
    toHaveScreenshot: {
      animations: "disabled",
      caret: "hide",
      // Absorbs anti-aliasing noise only; any visible change fails.
      maxDiffPixelRatio: 0.001,
    },
  },
  use: {
    baseURL: `http://localhost:${MAIN_PORT}`,
    trace: "on-first-retry",
  },
  projects: [
    { name: "mobile", use: { ...devices["Pixel 7"] } },
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
  ],
  webServer: [
    server(MAIN_PORT, "data/e2e.db"),
    server(BUSY_PORT, "data/e2e-busy.db", { LLM_DAILY_BUDGET: "0" }),
  ],
});
