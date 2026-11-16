import { FakeListChatModel } from "@langchain/core/utils/testing";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AI_BUSY_MESSAGE, AI_PAUSED_MESSAGE } from "@/lib/ai-busy";
import { AiBusyError, aiBusyText, isAiBusyError, LlmBudget } from "@/server/ai/budget";
import { getChatModel, ROLE_SETTINGS } from "@/server/ai/models";
import { rateLimits } from "@/server/db/schema";
import { parseEnv } from "@/server/env-schema";
import {
  aiActionLimits,
  chatLimits,
  clientIp,
  consumeRateLimits,
  tooManyRequests,
} from "@/server/limits/policies";
import {
  addToWindow,
  consumeRateLimit,
  DAY_MS,
  HOUR_MS,
  retryIn,
  windowCount,
} from "@/server/limits/rate-limits";
import { createTestDatabase } from "../helpers/db";
import { server } from "../helpers/msw";

/** LLM10: fixed-window rate limits, the daily LLM budget and its wiring into the model layer. */

let t: ReturnType<typeof createTestDatabase>;
beforeEach(() => {
  t = createTestDatabase();
});
afterEach(() => t.cleanup());

const at = (iso: string) => new Date(iso);

describe("fixed-window rate limits", () => {
  const limit = { key: "k", limit: 2, windowMs: HOUR_MS };

  it("allows up to the limit per window, then reports when the window ends", () => {
    const now = at("2026-11-16T10:20:00Z");
    expect(consumeRateLimit(t.db, limit, now)).toEqual({ ok: true });
    expect(consumeRateLimit(t.db, limit, now)).toEqual({ ok: true });
    expect(consumeRateLimit(t.db, limit, now)).toEqual({
      ok: false,
      retryAt: at("2026-11-16T11:00:00Z"),
    });
    // Refused attempts are not counted.
    expect(windowCount(t.db, "k", HOUR_MS, now)).toBe(2);
    expect(consumeRateLimit(t.db, limit, at("2026-11-16T11:00:00Z"))).toEqual({ ok: true });
  });

  it("refuses everything with a limit of 0", () => {
    expect(consumeRateLimit(t.db, { ...limit, limit: 0 })).toMatchObject({ ok: false });
    expect(windowCount(t.db, "k", HOUR_MS, new Date())).toBe(0);
  });

  it("deletes counters of windows that ended days ago", () => {
    consumeRateLimit(t.db, limit, at("2026-11-10T10:00:00Z"));
    consumeRateLimit(t.db, { ...limit, key: "other" }, at("2026-11-16T10:00:00Z"));
    expect(
      t.db
        .select()
        .from(rateLimits)
        .all()
        .map((r) => r.key),
    ).toEqual(["other"]);
  });

  it("records past uses without refusing, or raises the count to a floor", () => {
    const now = at("2026-11-16T10:00:00Z");
    addToWindow(t.db, "d", DAY_MS, now);
    addToWindow(t.db, "d", DAY_MS, now, { amount: 2 });
    expect(windowCount(t.db, "d", DAY_MS, now)).toBe(3);
    addToWindow(t.db, "d", DAY_MS, now, { amount: 0, atLeast: 10 });
    expect(windowCount(t.db, "d", DAY_MS, now)).toBe(10);
    addToWindow(t.db, "d", DAY_MS, now, { amount: 0, atLeast: 5 });
    expect(windowCount(t.db, "d", DAY_MS, now)).toBe(10);
    addToWindow(t.db, "e", DAY_MS, now, { amount: 0, atLeast: 4 });
    expect(windowCount(t.db, "e", DAY_MS, now)).toBe(4);
  });

  it("says when to retry in minutes or hours", () => {
    const now = at("2026-11-16T10:00:00Z");
    expect(retryIn(at("2026-11-16T10:00:10Z"), now)).toBe("in 1 minute");
    expect(retryIn(now, now)).toBe("in 1 minute");
    expect(retryIn(at("2026-11-16T10:25:00Z"), now)).toBe("in 25 minutes");
    expect(retryIn(at("2026-11-16T14:00:00Z"), now)).toBe("in 4 hours");
    expect(tooManyRequests(at("2026-11-16T10:25:00Z"), now)).toBe(
      "Too many requests. Please try again in 25 minutes.",
    );
  });
});

describe("client limits", () => {
  const env = parseEnv({
    RATE_LIMIT_CHAT_PER_HOUR: "3",
    RATE_LIMIT_CHAT_PER_TRIP_PER_DAY: "1",
    RATE_LIMIT_AI_ACTIONS_PER_HOUR: "1",
  });

  it("reads the limits from the environment, with defaults", () => {
    expect(parseEnv({})).toMatchObject({
      LLM_DAILY_BUDGET: 45,
      RATE_LIMIT_CHAT_PER_HOUR: 20,
      RATE_LIMIT_CHAT_PER_TRIP_PER_DAY: 40,
      RATE_LIMIT_AI_ACTIONS_PER_HOUR: 10,
    });
    expect(() => parseEnv({ LLM_DAILY_BUDGET: "-1" })).toThrow(/LLM_DAILY_BUDGET/);
    expect(() => parseEnv({ RATE_LIMIT_CHAT_PER_HOUR: "lots" })).toThrow(/RATE_LIMIT/);
  });

  it("limits chat turns per client and per trip", () => {
    const trip = crypto.randomUUID();
    expect(consumeRateLimits(t.db, chatLimits(env, "1.2.3.4", trip))).toEqual({ ok: true });
    expect(consumeRateLimits(t.db, chatLimits(env, "1.2.3.4", trip))).toMatchObject({ ok: false });
    // Another trip of the same client still has turns left; the home chat has no trip limit.
    expect(consumeRateLimits(t.db, chatLimits(env, "1.2.3.4", crypto.randomUUID()))).toEqual({
      ok: true,
    });
    expect(consumeRateLimits(t.db, chatLimits(env, "1.2.3.4"))).toMatchObject({ ok: false });
    expect(consumeRateLimits(t.db, chatLimits(env, "5.6.7.8"))).toEqual({ ok: true });
  });

  it("limits AI actions per client", () => {
    expect(consumeRateLimits(t.db, aiActionLimits(env, "1.2.3.4"))).toEqual({ ok: true });
    expect(consumeRateLimits(t.db, aiActionLimits(env, "1.2.3.4"))).toMatchObject({ ok: false });
  });

  it("identifies the client by the first forwarded address", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "203.0.113.5, 10.0.0.1" }))).toBe(
      "203.0.113.5",
    );
    expect(clientIp(new Headers({ "x-forwarded-for": " ::1 " }))).toBe("::1");
    expect(clientIp(new Headers({ "x-forwarded-for": "" }))).toBe("unknown");
    expect(clientIp(new Headers())).toBe("unknown");
  });
});

describe("daily LLM budget", () => {
  it("counts provider requests per UTC day", () => {
    let now = at("2026-11-16T23:30:00Z");
    const budget = new LlmBudget(t.db, 2, () => now);
    expect([budget.used(), budget.exhausted()]).toEqual([0, false]);
    budget.record();
    budget.record();
    expect([budget.used(), budget.exhausted()]).toEqual([2, true]);
    expect(budget.resetsAt()).toEqual(at("2026-11-17T00:00:00Z"));
    now = at("2026-11-17T00:00:00Z");
    expect(budget.exhausted()).toBe(false);
    budget.markExhausted();
    expect(budget.used()).toBe(2);
  });

  it("tells a paused day from a short provider hiccup", () => {
    const budget = new LlmBudget(t.db, 1);
    expect(aiBusyText(budget)).toBe(AI_BUSY_MESSAGE);
    expect(aiBusyText()).toBe(AI_BUSY_MESSAGE);
    budget.record();
    expect(aiBusyText(budget)).toBe(AI_PAUSED_MESSAGE);
  });

  it("recognizes busy errors, also as causes, but not other failures", () => {
    const status = (code: number) => Object.assign(new Error("x"), { status: code });
    const named = (name: string) => Object.assign(new Error("x"), { name });
    expect(isAiBusyError(new AiBusyError("budget"))).toBe(true);
    expect(new AiBusyError("provider").message).toBe(AI_BUSY_MESSAGE);
    expect(isAiBusyError(status(429))).toBe(true);
    expect(isAiBusyError(named("RateLimitCapacityError"))).toBe(true);
    expect(
      isAiBusyError(Object.assign(new Error("x"), { lc_error_code: "MODEL_RATE_LIMIT" })),
    ).toBe(true);
    expect(isAiBusyError(new Error("wrapped", { cause: status(429) }))).toBe(true);
    expect(isAiBusyError(status(500))).toBe(false);
    expect(isAiBusyError("429")).toBe(false);
    let deep: Error = status(429);
    for (let i = 0; i < 5; i++) deep = new Error("wrapper", { cause: deep });
    expect(isAiBusyError(deep)).toBe(false);
  });
});

describe("model layer with a budget", () => {
  const liveEnv = parseEnv({ LLM_MODE: "live", OPENROUTER_API_KEY: "test-key" });
  const fakeEnv = parseEnv({ LLM_MODE: "fake" });
  const COMPLETIONS = "https://openrouter.ai/api/v1/chat/completions";

  function completion(content: string) {
    return {
      id: "gen-1",
      object: "chat.completion",
      created: 0,
      model: "test",
      choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    };
  }

  it("counts every request sent to the provider", async () => {
    let calls = 0;
    server.use(
      http.post(COMPLETIONS, () => {
        calls++;
        return HttpResponse.json(completion("Ciao"));
      }),
    );
    const budget = new LlmBudget(t.db, 5);
    const model = getChatModel("agent", liveEnv, { budget });
    expect((await model.invoke("hello")).content).toBe("Ciao");
    expect([calls, budget.used()]).toEqual([1, 1]);
  });

  it("refuses calls once the budget is used up, without sending anything", async () => {
    let calls = 0;
    server.use(
      http.post(COMPLETIONS, () => {
        calls++;
        return HttpResponse.json(completion("{}"));
      }),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    const budget = new LlmBudget(t.db, 0);
    // The guard survives withStructuredOutput / bindTools, which rebuild the model.
    const model = getChatModel("discovery", liveEnv, { budget }).withStructuredOutput(
      z.object({ city: z.string() }),
    );
    await expect(model.invoke("which city?")).rejects.toBeInstanceOf(AiBusyError);
    expect(calls).toBe(0);
  });

  it("stops for the day when the provider's daily free quota is used up", async () => {
    server.use(
      http.post(COMPLETIONS, () =>
        HttpResponse.json(
          { error: { message: "Rate limit exceeded: free-models-per-day", code: 429 } },
          { status: 429 },
        ),
      ),
    );
    const budget = new LlmBudget(t.db, 45);
    const err = await getChatModel("agent", liveEnv, { budget })
      .invoke("hello")
      .catch((e: unknown) => e);
    expect(isAiBusyError(err)).toBe(true);
    expect(budget.exhausted()).toBe(true);
  });

  it("only waits out the provider's per-minute limit", async () => {
    server.use(
      http.post(COMPLETIONS, () =>
        HttpResponse.json(
          { error: { message: "Rate limit exceeded: free-models-per-min", code: 429 } },
          { status: 429 },
        ),
      ),
    );
    const budget = new LlmBudget(t.db, 45);
    const err = await getChatModel("agent", liveEnv, { budget })
      .invoke("hello")
      .catch((e: unknown) => e);
    expect(isAiBusyError(err)).toBe(true);
    expect(budget.exhausted()).toBe(false);
  });

  it("bounds every live request with a per-role timeout", () => {
    const model = getChatModel("planner", liveEnv) as unknown as { timeout: number };
    expect(model.timeout).toBe(ROLE_SETTINGS.planner.timeoutMs);
  });

  it("guards fake models too, so busy flows can be tested offline", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const budget = new LlmBudget(t.db, 1);
    const model = getChatModel("agent", fakeEnv, {
      budget,
      fake: () => new FakeListChatModel({ responses: ["OK"] }),
    });
    await expect(model.invoke("hello")).resolves.toMatchObject({ content: "OK" });
    // Fake calls are free.
    expect(budget.used()).toBe(0);
    budget.markExhausted();
    await expect(model.invoke("hello")).rejects.toBeInstanceOf(AiBusyError);
  });
});
