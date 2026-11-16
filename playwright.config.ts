import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;

/**
 * E2E tests run against the production build (`npm run build` first) with a throwaway
 * database and the offline fake LLM, so they never consume provider quota. tests/e2e/seed.ts
 * pre-fills the Photon cache and the Rome place pool, so the server never needs the network.
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
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
  },
  projects: [
    { name: "mobile", use: { ...devices["Pixel 7"] } },
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
  ],
  webServer: {
    command: `npm run db:migrate && node --import tsx tests/e2e/seed.ts && npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { LLM_MODE: "fake", DATABASE_PATH: "data/e2e.db" },
  },
});
