import { AIMessage } from "@langchain/core/messages";
import { FakeListChatModel } from "@langchain/core/utils/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { purgeExpiredLlmCache, SqliteLlmCache } from "@/server/ai/cache";
import { getChatModel } from "@/server/ai/models";
import { llmCache } from "@/server/db/schema";
import { parseEnv } from "@/server/env-schema";
import { cachedJson, DAY_MS, purgeExpiredHttpCache } from "@/server/places/http-cache";
import { searchCities } from "@/server/places/photon";
import { createTestDatabase } from "../helpers/db";
import { mockWikimedia } from "../helpers/msw";

let t: ReturnType<typeof createTestDatabase>;
beforeEach(() => {
  t = createTestDatabase();
});
afterEach(() => t.cleanup());

describe("http_cache", () => {
  it("reads through until the entry expires", async () => {
    let clock = new Date("2026-01-01T00:00:00Z");
    let loads = 0;
    const deps = { db: t.db, now: () => clock };
    const load = async () => ({ n: ++loads });

    expect(await cachedJson(deps, "k", DAY_MS, load)).toEqual({ n: 1 });
    expect(await cachedJson(deps, "k", DAY_MS, load)).toEqual({ n: 1 });

    clock = new Date(clock.getTime() + DAY_MS + 1);
    expect(await cachedJson(deps, "k", DAY_MS, load)).toEqual({ n: 2 });
    expect(purgeExpiredHttpCache(t.db, new Date(clock.getTime() + 2 * DAY_MS))).toBe(1);
  });

  it("does not cache failed loads", async () => {
    const deps = { db: t.db };
    await expect(
      cachedJson(deps, "k", DAY_MS, async () => {
        throw new Error("down");
      }),
    ).rejects.toThrow("down");
    await expect(cachedJson(deps, "k", DAY_MS, async () => "ok")).resolves.toBe("ok");
  });

  it("caches Photon city searches in SQLite", async () => {
    const { calls } = mockWikimedia({});
    // Unique query: the in-memory L1 cache is shared across tests.
    const result = await searchCities("Rome caches test", { db: t.db });
    expect(result[0]).toMatchObject({ name: "Rome", countryCode: "IT", osmRef: "R41485" });
    expect(calls).toHaveLength(1);
    expect(new URL(calls[0]).searchParams.get("layer")).toBe("city");
    expect(t.sqlite.prepare("SELECT key FROM http_cache").pluck().all()).toEqual([
      "photon:rome caches test",
    ]);

    // Repeated keystrokes are answered from memory: no SQLite read, no request.
    t.sqlite.prepare("DELETE FROM http_cache").run();
    expect(await searchCities("  ROME   caches test ", { db: t.db })).toBe(result);
    expect(calls).toHaveLength(1);
  });
});

describe("llm_cache", () => {
  const env = parseEnv({ LLM_MODE: "fake" });
  const fake = () => new FakeListChatModel({ responses: ["first", "second"] });

  it("answers repeated prompts from SQLite for cacheable roles", async () => {
    const cache = new SqliteLlmCache(t.db);
    const first = await getChatModel("discovery", env, { fake, cache }).invoke(
      "List places in Rome",
    );
    // A fresh model would answer "first" again; "second" proves it is a different instance.
    const again = await getChatModel("discovery", env, { fake, cache }).invoke(
      "List places in Rome",
    );
    const other = await getChatModel("discovery", env, { fake, cache }).invoke(
      "List places in Paris",
    );
    expect([first.content, again.content, other.content]).toEqual(["first", "first", "first"]);
    expect(t.db.select().from(llmCache).all()).toHaveLength(2);
  });

  it("never caches the chat agent", async () => {
    const cache = new SqliteLlmCache(t.db);
    const model = getChatModel("agent", env, { fake, cache });
    await model.invoke("hi");
    expect((await model.invoke("hi")).content).toBe("second");
    expect(t.db.select().from(llmCache).all()).toHaveLength(0);
  });

  it("round-trips tool calls (structured output via function calling)", async () => {
    const cache = new SqliteLlmCache(t.db);
    const message = new AIMessage({
      content: "",
      tool_calls: [{ id: "call_1", name: "attractions", args: { attractions: [] } }],
    });
    await cache.update("prompt", "llm", [{ text: "", message } as never]);
    const [hit] = (await cache.lookup("prompt", "llm")) as unknown as { message: AIMessage }[];
    expect(hit.message.tool_calls).toEqual([
      expect.objectContaining({ id: "call_1", name: "attractions", args: { attractions: [] } }),
    ]);
  });

  it("keeps the cache on live models wrapped for structured output", async () => {
    // Regression: a cache assigned after construction was dropped by withStructuredOutput,
    // so the first live seed stored nothing in llm_cache. A miss here would reach the
    // network, which msw rejects.
    const live = parseEnv({ LLM_MODE: "live", OPENROUTER_API_KEY: "test-key" });
    const cache = new SqliteLlmCache(t.db);
    const lookups: string[] = [];
    cache.lookup = async (prompt) => {
      lookups.push(prompt);
      const json = '{"city":"Rome"}';
      return [{ text: json, message: new AIMessage(json) } as never];
    };
    const model = getChatModel("discovery", live, { cache }).withStructuredOutput(
      z.object({ city: z.string() }),
      { name: "city" },
    );
    await expect(model.invoke("which city?")).resolves.toEqual({ city: "Rome" });
    expect(lookups).toHaveLength(1);
  });

  it("expires entries", async () => {
    let clock = new Date("2026-01-01T00:00:00Z");
    const cache = new SqliteLlmCache(t.db, DAY_MS, () => clock);
    await cache.update("p", "k", [{ text: "x" }]);
    expect(await cache.lookup("p", "k")).toEqual([{ text: "x" }]);
    clock = new Date(clock.getTime() + DAY_MS + 1);
    expect(await cache.lookup("p", "k")).toBeNull();
    expect(purgeExpiredLlmCache(t.db, clock)).toBe(1);
  });
});
