/**
 * Pre-computes the place pool of popular demo cities (workflow A), so that most visitors
 * never wait for (or spend quota on) an LLM call. Resumable: cities that already have a pool
 * are skipped without any request. One LLM call per new city.
 *
 * Usage:
 *   npm run db:seed                         # all demo cities (needs LLM_MODE=live)
 *   npm run db:seed -- --cities Rome,Paris  # a subset
 */
import { parseArgs } from "node:util";
import { awaitAllCallbacks } from "@langchain/core/callbacks/promises";
import { LlmBudget } from "../src/server/ai/budget";
import { SqliteLlmCache } from "../src/server/ai/cache";
import { openDatabase, runMigrations } from "../src/server/db/connection";
import { parseEnv } from "../src/server/env-schema";
import { upsertCity } from "../src/server/places/cities";
import { ensureCityPool, getCityPool, type DiscoveryDeps } from "../src/server/places/discover";
import { searchCities } from "../src/server/places/photon";

/** City name as typed in the autocomplete + ISO country code to pick the right match. */
const DEMO_CITIES: [string, string][] = [
  ["Rome", "IT"],
  ["Florence", "IT"],
  ["Venice", "IT"],
  ["Paris", "FR"],
  ["London", "GB"],
  ["Edinburgh", "GB"],
  ["Dublin", "IE"],
  ["Barcelona", "ES"],
  ["Madrid", "ES"],
  ["Lisbon", "PT"],
  ["Amsterdam", "NL"],
  ["Berlin", "DE"],
  ["Munich", "DE"],
  ["Prague", "CZ"],
  ["Vienna", "AT"],
  ["Budapest", "HU"],
  ["Copenhagen", "DK"],
  ["Athens", "GR"],
  ["Istanbul", "TR"],
  ["New York", "US"],
  ["San Francisco", "US"],
  ["Tokyo", "JP"],
  ["Kyoto", "JP"],
  ["Singapore", "SG"],
  ["Sydney", "AU"],
];

/** OpenRouter free models allow ~20 requests/minute. */
const PAUSE_AFTER_LLM_CALL_MS = 4000;

async function main() {
  const { values } = parseArgs({ options: { cities: { type: "string" } } });
  const only = values.cities?.split(",").map((c) => c.trim().toLowerCase());
  const targets = only
    ? DEMO_CITIES.filter(([name]) => only.includes(name.toLowerCase()))
    : DEMO_CITIES;

  const env = parseEnv();
  if (env.LLM_MODE === "fake") {
    console.warn("LLM_MODE=fake: only the fixture cities (Rome, Paris) will get places.");
  }
  const { db, sqlite } = openDatabase(env.DATABASE_PATH);
  runMigrations(db);
  // Seeding spends the same free quota as the app, so it counts against the daily budget.
  const budget = new LlmBudget(db, env.LLM_DAILY_BUDGET);
  const deps: DiscoveryDeps = { db, env, llmCache: new SqliteLlmCache(db), budget };

  const summary: { city: string; status: string; places: number }[] = [];
  for (const [name, countryCode] of targets) {
    try {
      const match = (await searchCities(name, deps)).find((c) => c.countryCode === countryCode);
      if (!match) throw new Error(`no ${countryCode} match on Photon`);
      const city = upsertCity(db, match);
      const before = getCityPool(db, city.id).length;
      const pool = await ensureCityPool(city, deps);
      summary.push({ city: name, status: before ? "cached" : "discovered", places: pool.length });
      console.log(`${name}: ${pool.length} places${before ? " (cached)" : ""}`);
      if (!before) await new Promise((r) => setTimeout(r, PAUSE_AFTER_LLM_CALL_MS));
    } catch (err) {
      summary.push({ city: name, status: `error: ${String(err).slice(0, 80)}`, places: 0 });
      console.error(`${name}: failed`, err);
    }
  }

  console.table(summary);
  console.log(`LLM requests today: ${budget.used()}/${budget.limit}`);
  sqlite.close();
  // Flush pending LangSmith traces before the process exits.
  await awaitAllCallbacks();
  if (summary.some((s) => s.status.startsWith("error"))) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
