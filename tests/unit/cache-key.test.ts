import { describe, expect, it } from "vitest";
import { stableLlmKey } from "@/server/ai/cache";

/** Shape of LangChain's llmKey: `name:<json>` entries, sorted and joined by commas. */
const entries = (fields: Record<string, unknown>) =>
  Object.entries(fields)
    .map(([k, v]) => `${k}:${JSON.stringify(v)}`)
    .sort()
    .join(",");

const SCHEMA = {
  name: "itinerary",
  schema: { description: 'At most 40 characters, without "Day N", e.g. P3,x:y {not} [json]' },
};

/** A planner call as LangChain keys it inside a LangGraph node (live model). */
const plannerKey = (run: { checkpointId: string; time: number }, extra = {}) =>
  entries({
    _model: "base_chat_model",
    _type: "openai",
    apiKey: "sk-secret",
    baseURL: "https://openrouter.ai/api/v1",
    control: {},
    executionInfo: { checkpointId: run.checkpointId, nodeFirstAttemptTime: run.time },
    interrupt: undefined,
    max_tokens: 8192,
    model: "openrouter/free",
    response_format: { type: "json_schema", json_schema: SCHEMA },
    signal: {},
    temperature: 0.2,
    ...extra,
  });

describe("stableLlmKey", () => {
  it("ignores per-run values and the API key", () => {
    const first = stableLlmKey(plannerKey({ checkpointId: "a", time: 1 }));
    const second = stableLlmKey(plannerKey({ checkpointId: "b", time: 2 }, { apiKey: "sk-new" }));
    expect(first).toBe(second);
    expect(first).not.toMatch(/executionInfo|apiKey|sk-secret|signal|interrupt|control/);
    expect(first).toBe(
      entries({
        _model: "base_chat_model",
        _type: "openai",
        baseURL: "https://openrouter.ai/api/v1",
        max_tokens: 8192,
        model: "openrouter/free",
        response_format: { type: "json_schema", json_schema: SCHEMA },
        temperature: 0.2,
      }),
    );
  });

  it("still tells apart the model, its settings and the response schema", () => {
    const run = { checkpointId: "a", time: 1 };
    const keys = [
      plannerKey(run),
      plannerKey(run, { model: "other/model:free" }),
      plannerKey(run, { temperature: 0.3 }),
      plannerKey(run, { response_format: { type: "json_schema", json_schema: { name: "x" } } }),
      plannerKey(run, { tools: [{ type: "function", function: { name: "attractions" } }] }),
    ].map(stableLlmKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("reads string values with escaped quotes and backslashes", () => {
    const key = entries({ stop: ['a\\"b', "c,d:e"], signal: {}, model: 'q"uoted' });
    expect(stableLlmKey(key)).toBe(entries({ stop: ['a\\"b', "c,d:e"], model: 'q"uoted' }));
  });

  it("keeps a malformed key whole: a miss is safe, a wrong hit is not", () => {
    for (const key of [
      "llm",
      'model:"unterminated',
      "tools:[{}",
      'model:"a"x,signal:{}',
      "model:1,,signal:{}",
    ]) {
      expect(stableLlmKey(key)).toBe(key);
    }
  });

  it("returns an empty key when nothing in it shapes the answer", () => {
    expect(stableLlmKey("signal:{},writer:undefined")).toBe("");
    expect(stableLlmKey("")).toBe("");
  });
});
