import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { FakeListChatModel } from "@langchain/core/utils/testing";
import { ChatOpenAI } from "@langchain/openai";
import type { Env } from "@/server/env-schema";

export type ModelRole = "agent" | "planner" | "discovery";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

/** Per-role generation settings: low temperature where we need reliable JSON. */
const ROLE_SETTINGS: Record<ModelRole, { temperature: number; maxTokens: number }> = {
  agent: { temperature: 0.4, maxTokens: 1024 },
  planner: { temperature: 0.2, maxTokens: 4096 },
  discovery: { temperature: 0.3, maxTokens: 4096 },
};

type ModelEnv = Pick<Env, "LLM_MODE" | "OPENROUTER_API_KEY" | "OPENROUTER_MODEL">;

/** OpenRouter free model through its OpenAI-compatible API (the only provider for now). */
export function createOpenRouterModel(role: ModelRole, env: ModelEnv): BaseChatModel {
  const s = ROLE_SETTINGS[role];
  return new ChatOpenAI({
    apiKey: env.OPENROUTER_API_KEY,
    model: env.OPENROUTER_MODEL,
    temperature: s.temperature,
    maxTokens: s.maxTokens,
    // Retries with backoff on 429/5xx; free models are rate limited per minute.
    maxRetries: 2,
    configuration: { baseURL: OPENROUTER_BASE_URL },
  });
}

/** Offline deterministic model used for tests, CI and UI development (LLM_MODE=fake). */
export function createFakeModel(responses: string[] = ["OK"]): BaseChatModel {
  return new FakeListChatModel({ responses });
}

/**
 * Single entry point for chat models. Apply `bindTools` / `withStructuredOutput` on the result.
 * `fake` lets callers supply scripted responses for LLM_MODE=fake.
 */
export function getChatModel(
  role: ModelRole,
  env: ModelEnv,
  fake: () => BaseChatModel = () => createFakeModel(),
): BaseChatModel {
  return env.LLM_MODE === "fake" ? fake() : createOpenRouterModel(role, env);
}
