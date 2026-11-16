import "server-only";
import { SqliteLlmCache } from "@/server/ai/cache";
import { llmBudget } from "@/server/ai/runtime";
import { db } from "@/server/db/client";
import { env } from "@/server/env";
import type { DiscoveryDeps } from "./discover";

/** Workflow A dependencies for the Next.js runtime (shared connection, LLM cache and budget). */
export const discoveryDeps: DiscoveryDeps = {
  db,
  env,
  llmCache: new SqliteLlmCache(db),
  budget: llmBudget,
};
