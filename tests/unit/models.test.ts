import { FakeListChatModel } from "@langchain/core/utils/testing";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { getChatModel, ROLE_SETTINGS } from "@/server/ai/models";
import { INITIAL_CANDIDATES } from "@/server/places/discover";
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

  it("requires the LangSmith key when tracing is on", () => {
    expect(() => parseEnv({ LANGSMITH_TRACING: "true" })).toThrow(/LANGSMITH_API_KEY/);
    expect(parseEnv({ LANGSMITH_TRACING: "true", LANGSMITH_API_KEY: "k" }).LANGSMITH_TRACING).toBe(
      "true",
    );
  });

  it("accepts a LangSmith agent address only when complete", () => {
    const env = parseEnv({
      LANGSMITH_AGENT_ID: "travel-swipe",
      LANGSMITH_AGENT_ENVIRONMENT: "Production",
    });
    expect(env.LANGSMITH_AGENT_ENVIRONMENT).toBe("production");
    expect(() => parseEnv({ LANGSMITH_AGENT_ID: "travel-swipe" })).toThrow(
      /LANGSMITH_AGENT_ENVIRONMENT/,
    );
    expect(() => parseEnv({ LANGSMITH_AGENT_ENVIRONMENT: "local" })).toThrow(/LANGSMITH_AGENT_ID/);
    expect(() => parseEnv({ LANGSMITH_AGENT_ID: "Travel Swipe" })).toThrow(/LANGSMITH_AGENT_ID/);
  });

  it("treats empty variables as unset", () => {
    const env = parseEnv({ LANGSMITH_ENDPOINT: "", LANGSMITH_AGENT_ID: "", DATABASE_PATH: "" });
    expect(env.LANGSMITH_ENDPOINT).toBeUndefined();
    expect(env.DATABASE_PATH).toBe("data/app.db");
  });

  it("rejects a LangSmith project together with an agent address", () => {
    expect(() =>
      parseEnv({
        LANGSMITH_AGENT_ID: "travel-swipe",
        LANGSMITH_AGENT_ENVIRONMENT: "local",
        LANGSMITH_PROJECT: "travel-swipe",
      }),
    ).toThrow(/LANGSMITH_PROJECT/);
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

  it("leaves discovery enough output tokens for a full batch plus reasoning", () => {
    // Regression: 4096 tokens cut the first live 40-attraction answer (LengthFinishReasonError).
    const model = getChatModel("discovery", liveEnv) as unknown as { maxTokens: number };
    expect(model.maxTokens).toBe(ROLE_SETTINGS.discovery.maxTokens);
    expect(model.maxTokens).toBeGreaterThanOrEqual(INITIAL_CANDIDATES * 200 + 4096);
  });

  it("supports structured output with scripted fake responses", async () => {
    const Schema = z.object({ city: z.string() });
    const model = getChatModel("discovery", fakeEnv, {
      fake: () => new FakeListChatModel({ responses: ['{"city":"Rome"}'] }),
    });
    await expect(model.withStructuredOutput(Schema).invoke("which city?")).resolves.toEqual({
      city: "Rome",
    });
  });
});
