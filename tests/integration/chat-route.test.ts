import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_CHAT_BODY_CHARS, POST } from "@/app/api/chat/route";
import { AI_PAUSED_MESSAGE } from "@/lib/ai-busy";
import { llmBudget } from "@/server/ai/runtime";
import { addToWindow, DAY_MS, HOUR_MS } from "@/server/limits/rate-limits";
import { loadChatHistoryAction } from "@/server/actions/chat";
import { chatDeps } from "@/server/agent/deps";
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

  it("refuses oversized bodies before parsing them", async () => {
    // Regression: a 5 MB body was read and parsed in full (the schema only bounds the fields).
    let res = await post({ text: "hi", pad: "x".repeat(MAX_CHAT_BODY_CHARS) });
    expect([res.status, await res.text()]).toEqual([413, "Request too large."]);
    res = await POST(
      new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "Content-Length": String(MAX_CHAT_BODY_CHARS * 4 + 1) },
        body: "{}",
      }),
    );
    expect([res.status, await res.text()]).toEqual([413, "Request too large."]);
    // The largest valid request still fits, every character escaped.
    const history = Array.from({ length: 10 }, () => ({ role: "user", text: "".repeat(2000) }));
    res = await post({ text: "hello", history });
    expect(JSON.stringify({ text: "hello", history }).length).toBeLessThan(MAX_CHAT_BODY_CHARS);
    expect(res.status).toBe(200);
    await res.text();
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

  it("ends a turn quietly when the client goes away mid-stream", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    const controller = new AbortController();
    const res = await POST(
      new Request("http://localhost/api/chat", {
        method: "POST",
        body: JSON.stringify({ tripId: trip.id, text: "hello" }),
        signal: controller.signal,
      }),
    );
    expect(res.status).toBe(200);
    // What Next.js does when the browser closes the request (Stop, Esc, closed tab).
    controller.abort(Object.assign(new Error(""), { name: "ResponseAborted" }));
    await res.text();
    expect(error).not.toHaveBeenCalled();
    const next = await post({ tripId: trip.id, text: "hello" });
    expect([next.status, await next.text()]).toEqual([200, expect.stringContaining("I can start")]);
    error.mockRestore();
  });

  it("answers 503 when the turn cannot start, logging only real failures", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    // The client went away before the run started: not an error worth logging.
    let res = await POST(
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
    expect(error).not.toHaveBeenCalled();

    // A real failure while setting the turn up is logged.
    const fake = chatDeps.fake;
    chatDeps.fake = () => {
      throw new Error("model setup failed");
    };
    try {
      res = await post({ tripId: trip.id, text: "hello" });
    } finally {
      chatDeps.fake = fake;
    }
    expect([res.status, await res.text()]).toEqual([
      503,
      "The assistant is unavailable right now. Please try again.",
    ]);
    expect(error).toHaveBeenCalledWith("Chat turn could not start", expect.any(Error));
    error.mockRestore();
  });
});

describe("POST /api/chat limits (LLM10)", () => {
  it("rate limits turns per client and per trip, without running them", async () => {
    addToWindow(db, `chat:trip:${trip.id}`, DAY_MS, new Date(), { atLeast: 40 });
    let res = await post({ tripId: trip.id, text: "hello" });
    expect(res.status).toBe(429);
    expect(await res.text()).toMatch(
      /^Too many requests\. Please try again in \d+ (minutes?|hours)\.$/,
    );
    expect(await loadChatHistoryAction(trip.id)).toEqual([]);

    addToWindow(db, "chat:ip:unknown", HOUR_MS, new Date(), { atLeast: 20 });
    res = await post({ text: "hello" });
    expect(res.status).toBe(429);
  });

  it("refuses turns up front while the daily LLM budget is used up", async () => {
    llmBudget.markExhausted();
    const res = await post({ tripId: trip.id, text: "hello" });
    expect([res.status, await res.text()]).toEqual([503, AI_PAUSED_MESSAGE]);
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
