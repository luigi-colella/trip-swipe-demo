/**
 * Offline fixtures for the E2E run: a cached Photon answer for "rome" and a ready Rome place
 * pool, so the production server never calls Photon, Wikipedia or an LLM during the tests.
 * Idempotent; refreshes timestamps so nothing is ever considered stale.
 * Usage (from playwright.config.ts): node --import tsx tests/e2e/seed.ts
 */
import { places } from "../../src/server/db/schema";
import { openDatabase, runMigrations } from "../../src/server/db/connection";
import { parseEnv } from "../../src/server/env-schema";
import { upsertCity } from "../../src/server/places/cities";
import { DAY_MS, writeHttpCache } from "../../src/server/places/http-cache";
import { parsePhotonResponse } from "../../src/server/places/photon";

export const PHOTON_ROME = {
  features: [
    {
      geometry: { coordinates: [12.4829, 41.8933] },
      properties: {
        osm_type: "R",
        osm_id: 41485,
        name: "Rome",
        state: "Lazio",
        country: "Italy",
        countrycode: "IT",
      },
    },
    {
      geometry: { coordinates: [-85.1647, 34.257] },
      properties: {
        osm_type: "R",
        osm_id: 119557,
        name: "Rome",
        state: "Georgia",
        country: "United States",
        countrycode: "US",
      },
    },
  ],
};

/** [name, category, tags, visit minutes, popularity]; no photos (the browser stays offline too). */
const ROME_PLACES: [string, string, string[], number, number][] = [
  ["Colosseum", "historic-site", ["history", "iconic"], 120, 9000],
  ["Pantheon", "landmark", ["history", "architecture", "iconic"], 30, 7000],
  ["Trevi Fountain", "landmark", ["art", "iconic"], 20, 6000],
  ["Vatican Museums", "museum", ["art", "history"], 180, 5000],
  ["Galleria Borghese", "museum", ["art"], 120, 2000],
  ["Villa Borghese", "park", ["nature", "family"], 90, 1500],
  ["Campo de' Fiori", "market", ["food", "local-life"], 45, 1200],
  ["Aventine Keyhole", "viewpoint", ["views", "hidden-gem"], 20, 800],
];

function main() {
  const env = parseEnv();
  if (!env.DATABASE_PATH.includes("e2e")) {
    throw new Error(`Refusing to seed E2E fixtures into ${env.DATABASE_PATH}`);
  }
  const { db, sqlite } = openDatabase(env.DATABASE_PATH);
  runMigrations(db);
  const now = new Date();

  writeHttpCache(db, "photon:rome", PHOTON_ROME, 365 * DAY_MS, now);
  const rome = upsertCity(db, parsePhotonResponse(PHOTON_ROME)[0]);

  for (const [name, category, tags, visitMinutes, popularity] of ROME_PLACES) {
    const wikiUrl = `https://en.wikipedia.org/wiki/${encodeURIComponent(name.replace(/ /g, "_"))}`;
    db.insert(places)
      .values({
        id: crypto.randomUUID(),
        cityId: rome.id,
        wikiTitle: name,
        wikiUrl,
        name,
        category,
        tags,
        pitch: `${name} is a must for any first visit to Rome.`,
        lat: 41.9,
        lon: 12.48,
        visitMinutes,
        popularity,
        fetchedAt: now,
      })
      .onConflictDoUpdate({ target: [places.cityId, places.wikiTitle], set: { fetchedAt: now } })
      .run();
  }
  console.log(`Seeded E2E fixtures into ${env.DATABASE_PATH} (${ROME_PLACES.length} places).`);
  sqlite.close();
}

main();
