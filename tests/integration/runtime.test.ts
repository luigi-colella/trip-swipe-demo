import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { http, HttpResponse } from "msw";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mockWikimedia, server } from "../helpers/msw";

/**
 * Modules that only run inside Next.js: the shared database client (opened from
 * DATABASE_PATH), the validated env, the runtime deps, the trip loader and the API routes.
 */
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: async () => {},
}));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "trip-swipe-runtime-"));
const globals = globalThis as { __tripSwipeDb?: { sqlite: { close(): void } } };

beforeAll(() => {
  vi.stubEnv("DATABASE_PATH", path.join(dir, "app.db"));
});
afterAll(() => {
  globals.__tripSwipeDb?.sqlite.close();
  delete globals.__tripSwipeDb;
  vi.unstubAllEnvs();
  fs.rmSync(dir, { recursive: true, force: true });
});

async function client() {
  const mod = await import("@/server/db/client");
  const { runMigrations } = await import("@/server/db/connection");
  runMigrations(mod.db);
  return mod;
}

describe("runtime modules", () => {
  it("opens one shared connection per process, reused across module reloads (HMR)", async () => {
    const first = await client();
    expect(first.sqlite.name).toBe(path.join(dir, "app.db"));
    vi.resetModules();
    const second = await import("@/server/db/client");
    expect(second.connection).toBe(first.connection);
    expect(second.db).toBe(first.db);
  });

  it("validates the environment and wires the runtime dependencies", async () => {
    const { env } = await import("@/server/env");
    expect(env).toMatchObject({ LLM_MODE: "fake", DATABASE_PATH: path.join(dir, "app.db") });
    const { discoveryDeps } = await import("@/server/places/deps");
    const { plannerDeps } = await import("@/server/itinerary/deps");
    const { db } = await client();
    expect(discoveryDeps.db).toBe(db);
    expect(discoveryDeps.llmCache).toBeDefined();
    expect(plannerDeps).toMatchObject({ env });
    expect(plannerDeps.llmCache).toBeDefined();
  });

  it("loads a trip or renders the not-found page", async () => {
    const { db } = await client();
    const { upsertCity } = await import("@/server/places/cities");
    const { createTrip } = await import("@/server/trips/trips");
    const { loadTripOr404 } = await import("@/server/trips/load");
    const city = upsertCity(db, {
      osmRef: "R1",
      name: "Rome",
      state: null,
      country: "Italy",
      countryCode: "IT",
      lat: 41.9,
      lon: 12.5,
    });
    const trip = createTrip(db, { cityId: city.id, days: 1, pace: "relaxed", interests: [] });
    expect((await loadTripOr404(trip.id)).city.name).toBe("Rome");
    await expect(loadTripOr404("not-a-uuid")).rejects.toThrow("NOT_FOUND");
    await expect(loadTripOr404("00000000-0000-4000-8000-000000000000")).rejects.toThrow(
      "NOT_FOUND",
    );
  });
});

describe("GET /api/health", () => {
  it("reports the database and the LLM mode", async () => {
    const { sqlite } = await client();
    const { GET } = await import("@/app/api/health/route");
    const body = await (await GET()).json();
    expect(body).toMatchObject({ status: "ok", llmMode: "fake" });
    const tables = sqlite.prepare("SELECT count(*) FROM sqlite_master WHERE type = 'table'");
    expect(body.tables).toBe(tables.pluck().get());
    expect(body.sqlite).toMatch(/^\d+\.\d+/);
  });
});

describe("GET /api/cities", () => {
  const get = async (q?: string) => {
    await client();
    const { GET } = await import("@/app/api/cities/route");
    const url = new URL("http://localhost/api/cities");
    if (q !== undefined) url.searchParams.set("q", q);
    return GET(new NextRequest(url));
  };

  it("rejects queries that are missing, too short or too long", async () => {
    for (const q of [undefined, "r", "x".repeat(81)]) {
      const res = await get(q);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "Query must be 2-80 characters." });
    }
  });

  it("returns suggestions the browser may cache", async () => {
    mockWikimedia({});
    const res = await get("rome route");
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=86400");
    expect((await res.json()).cities[0]).toMatchObject({ name: "Rome", osmRef: "R41485" });
  });

  it("answers 502 when Photon is unavailable", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    server.use(http.get("https://photon.komoot.io/api/", () => HttpResponse.error()));
    const res = await get("rome unavailable");
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "City search is unavailable, please retry." });
  });
});
