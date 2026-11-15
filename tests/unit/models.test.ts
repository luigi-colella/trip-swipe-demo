import { FakeListChatModel } from "@langchain/core/utils/testing";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { getChatModel } from "@/server/ai/models";
import { parseEnv } from "@/server/env-schema";

const fakeEnv = parseEnv({ LLM_MODE: "fake" });
const liveEnv = parseEnv({ LLM_MODE: "live", OPENROUTER_API_KEY: "test-key" });

describe("env", () => {
  it("defaults to fake mode without keys", () => {
    expect(parseEnv({}).LLM_MODE).toBe("fake");
  });

  it("requires the OpenRouter key in live mode", () => {
    expect(() => parseEnv({ LLM_MODE: "live" })).toThrow(/OPENROUTER_API_KEY/);
  });
});

describe("model layer", () => {
  it("returns an offline model in fake mode", async () => {
    const res = await getChatModel("agent", fakeEnv).invoke("hello");
    expect(res.content).toBe("OK");
  });

  it("uses OpenRouter through the OpenAI-compatible client in live mode", () => {
    const model = getChatModel("planner", liveEnv);
    expect(model.getName()).toBe("ChatOpenAI");
    expect((model as unknown as { model: string }).model).toBe(liveEnv.OPENROUTER_MODEL);
  });

  it("supports structured output with scripted fake responses", async () => {
    const Schema = z.object({ city: z.string() });
    const model = getChatModel(
      "discovery",
      fakeEnv,
      () => new FakeListChatModel({ responses: ['{"city":"Rome"}'] }),
    );
    await expect(model.withStructuredOutput(Schema).invoke("which city?")).resolves.toEqual({
      city: "Rome",
    });
  });
});
