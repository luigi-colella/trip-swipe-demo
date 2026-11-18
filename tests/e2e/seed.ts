/**
 * Offline fixtures for the E2E run: cached Photon answers for "rome", "paris" and "siracusa"
 * and a ready Rome place pool (the others have none), so the production server never calls
 * Photon, Wikipedia or an LLM during the tests.
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

/** A city without a place pool: opening it needs discovery (the AI-is-busy E2E server). */
export const PHOTON_PARIS = {
  features: [
    {
      geometry: { coordinates: [2.3522, 48.8566] },
      properties: {
        osm_type: "R",
        osm_id: 7444,
        name: "Paris",
        state: "Ile-de-France",
        country: "France",
        countrycode: "FR",
      },
    },
  ],
};

/**
 * A city the fake LLM knows no attractions for: discovery finds nothing, offline, so the swipe
 * step shows the "no attractions" state.
 */
export const PHOTON_SIRACUSA = {
  features: [
    {
      geometry: { coordinates: [15.2866, 37.0755] },
      properties: {
        osm_type: "R",
        osm_id: 39223,
        name: "Siracusa",
        state: "Sicily",
        country: "Italy",
        countrycode: "IT",
      },
    },
  ],
};

/**
 * [name, category, tags, visit minutes, popularity, lat, lon]; real coordinates so that the
 * itinerary clusters, legs and map are realistic. No photos (the browser stays offline too).
 */
const ROME_PLACES: [string, string, string[], number, number, number, number][] = [
  ["Colosseum", "historic-site", ["history", "iconic"], 120, 9000, 41.8902, 12.4922],
  ["Pantheon", "landmark", ["history", "architecture", "iconic"], 30, 7000, 41.8986, 12.4769],
  ["Trevi Fountain", "landmark", ["art", "iconic"], 20, 6000, 41.9009, 12.4833],
  ["Vatican Museums", "museum", ["art", "history"], 180, 5000, 41.9065, 12.4536],
  ["Galleria Borghese", "museum", ["art"], 120, 2000, 41.9142, 12.4921],
  ["Villa Borghese", "park", ["nature", "family"], 90, 1500, 41.9128, 12.4852],
  ["Campo de' Fiori", "market", ["food", "local-life"], 45, 1200, 41.8956, 12.4722],
  ["Aventine Keyhole", "viewpoint", ["views", "hidden-gem"], 20, 800, 41.8829, 12.4787],
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
  writeHttpCache(db, "photon:paris", PHOTON_PARIS, 365 * DAY_MS, now);
  writeHttpCache(db, "photon:siracusa", PHOTON_SIRACUSA, 365 * DAY_MS, now);
  const rome = upsertCity(db, parsePhotonResponse(PHOTON_ROME)[0]);

  for (const [name, category, tags, visitMinutes, popularity, lat, lon] of ROME_PLACES) {
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
        lat,
        lon,
        visitMinutes,
        popularity,
        fetchedAt: now,
      })
      .onConflictDoUpdate({
        target: [places.cityId, places.wikiTitle],
        set: { fetchedAt: now, lat, lon },
      })
      .run();
  }
  console.log(`Seeded E2E fixtures into ${env.DATABASE_PATH} (${ROME_PLACES.length} places).`);
  sqlite.close();
}

main();
