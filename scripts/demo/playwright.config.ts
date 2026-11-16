import { defineConfig } from "@playwright/test";

const PORT = 3200;
const SIZE = { width: 1280, height: 800 };

/**
 * Records the demo video (`npm run demo:record`, after `npm run build`): the full flow on a
 * copy of the local database (real Rome photos) with the offline fake LLM, so it costs no
 * provider quota. Photos and map tiles are loaded from the network. The video lands in
 * test-results/demo/; see the README's "Demo" section to turn it into docs/media/demo.gif.
 */
export default defineConfig({
  testDir: ".",
  outputDir: "../../test-results/demo",
  timeout: 180_000,
  retries: 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: SIZE,
    video: { mode: "on", size: SIZE },
  },
  webServer: {
    command: `node --import tsx scripts/demo/prepare-db.ts && npm run db:migrate && npx next start -p ${PORT}`,
    cwd: "../..",
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      LLM_MODE: "fake",
      DATABASE_PATH: "data/demo.db",
      LANGSMITH_TRACING: "false",
      LLM_DAILY_BUDGET: "10000",
      RATE_LIMIT_CHAT_PER_HOUR: "10000",
      RATE_LIMIT_CHAT_PER_TRIP_PER_DAY: "10000",
      RATE_LIMIT_AI_ACTIONS_PER_HOUR: "10000",
    },
  },
});
