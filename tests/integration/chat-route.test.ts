import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/chat/route";
import { loadChatHistoryAction } from "@/server/actions/chat";
import { db, sqlite } from "@/server/db/client";
import { upsertCity } from "@/server/places/cities";
import { createTrip, type Trip } from "@/server/trips/trips";
import { resetDatabase } from "../helpers/db";

/**
 * POST /api/chat and the chat Server Action against a throwaway database (the app's shared
 * client is swapped for it), with the offline fake agent.
 */
const t = vi.hoisted(() => ({ cleanup: () => {} }));
vi.mock("@/server/db/client", async () => {
  const { createTestDatabase } = await import("../helpers/db");
  const created = createTestDatabase();
  t.cleanup = created.cleanup;
  return { db: created.db, sqlite: created.sqlite, connection: created };
});
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: async () => {},
}));

let trip: Trip;
beforeEach(() => {
  resetDatabase(sqlite);
  const city = upsertCity(db, {
    osmRef: "R41485",
    name: "Rome",
    state: "Lazio",
    country: "Italy",
    countryCode: "IT",
    lat: 41.8933,
    lon: 12.4829,
  });
  trip = createTrip(db, { cityId: city.id, days: 2, pace: "balanced", interests: [] });
});
afterAll(() => t.cleanup());

const post = (body: unknown) =>
  POST(
    new Request("http://localhost/api/chat", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

describe("POST /api/chat", () => {
  it("streams a turn as AI SDK UI message chunks", async () => {
    const res = await post({ tripId: trip.id, text: "hello" });
    expect(res.status).toBe(200);
    expect(res.headers.get("x-vercel-ai-ui-message-stream")).toBe("v1");
    expect(await res.text()).toContain("I can start a trip");
  });

  it("rejects invalid bodies and unknown trips with a short message", async () => {
    let res = await post("not json");
    expect([res.status, await res.text()]).toEqual([
      400,
      "Invalid input: expected object, received null",
    ]);
    res = await post({ text: "x".repeat(501) });
    expect([res.status, await res.text()]).toEqual([400, "Message too long."]);
    res = await post({ tripId: crypto.randomUUID(), text: "hi" });
    expect([res.status, await res.text()]).toEqual([404, "Trip not found."]);
  });

  it("answers 409 while the trip's previous turn is running", async () => {
    const first = await post({ tripId: trip.id, text: "hello" });
    const second = await post({ tripId: trip.id, text: "again" });
    expect([second.status, await second.text()]).toEqual([
      409,
      "The assistant is still answering your previous message.",
    ]);
    await first.text();
  });

  it("answers 503 when the turn cannot start", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    // The client went away before the run started.
    const res = await POST(
      new Request("http://localhost/api/chat", {
        method: "POST",
        body: JSON.stringify({ tripId: trip.id, text: "hello" }),
        signal: AbortSignal.abort(),
      }),
    );
    expect([res.status, await res.text()]).toEqual([
      503,
      "The assistant is unavailable right now. Please try again.",
    ]);
  });
});

describe("loadChatHistoryAction", () => {
  it("returns the trip's conversation, or nothing for invalid or unknown trips", async () => {
    await (await post({ tripId: trip.id, text: "hello" })).text();
    expect((await loadChatHistoryAction(trip.id)).map((m) => m.role)).toEqual([
      "user",
      "assistant",
    ]);
    expect(await loadChatHistoryAction("nope")).toEqual([]);
    expect(await loadChatHistoryAction(crypto.randomUUID())).toEqual([]);
  });
});
