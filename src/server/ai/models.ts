import type { BaseCache } from "@langchain/core/caches";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { FakeListChatModel } from "@langchain/core/utils/testing";
import { ChatOpenAI } from "@langchain/openai";
import type { Env } from "@/server/env-schema";

export type ModelRole = "agent" | "planner" | "discovery";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

/**
 * Per-role generation settings: low temperature where we need reliable JSON.
 * maxTokens also covers the hidden reasoning of the reasoning models openrouter/free often
 * picks: 40 discovery candidates (~3.5k JSON tokens) overflowed 4096 on the first live run,
 * so the planner (up to ~40 stops plus reasoning) gets the same headroom.
 */
export const ROLE_SETTINGS: Record<ModelRole, { temperature: number; maxTokens: number }> = {
  agent: { temperature: 0.4, maxTokens: 1024 },
  planner: { temperature: 0.2, maxTokens: 8192 },
  discovery: { temperature: 0.3, maxTokens: 16_384 },
};

/** Roles whose answers depend only on the prompt, so an exact-match cache is safe. */
const CACHEABLE_ROLES: ReadonlySet<ModelRole> = new Set(["discovery", "planner"]);

type ModelEnv = Pick<Env, "LLM_MODE" | "OPENROUTER_API_KEY" | "OPENROUTER_MODEL">;

/** OpenRouter free model through its OpenAI-compatible API (the only provider for now). */
export function createOpenRouterModel(
  role: ModelRole,
  env: ModelEnv,
  cache?: BaseCache,
): BaseChatModel {
  const s = ROLE_SETTINGS[role];
  return new ChatOpenAI({
    // Must be a constructor field: ChatOpenAI rebuilds itself from its fields in
    // withStructuredOutput / bindTools, so a cache assigned afterwards is silently dropped.
    cache,
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

export type ChatModelOptions = {
  /** Scripted model for LLM_MODE=fake (defaults to a model that answers "OK"). */
  fake?: () => BaseChatModel;
  /** Exact-match cache (e.g. SqliteLlmCache); ignored for roles that must not be cached. */
  cache?: BaseCache;
};

/**
 * Single entry point for chat models. Apply `bindTools` / `withStructuredOutput` on the result.
 */
export function getChatModel(
  role: ModelRole,
  env: ModelEnv,
  { fake = () => createFakeModel(), cache }: ChatModelOptions = {},
): BaseChatModel {
  const roleCache = CACHEABLE_ROLES.has(role) ? cache : undefined;
  if (env.LLM_MODE !== "fake") return createOpenRouterModel(role, env, roleCache);
  const model = fake();
  if (roleCache) model.cache = roleCache;
  return model;
}
