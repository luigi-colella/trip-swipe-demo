import "server-only";
import { SqliteLlmCache } from "@/server/ai/cache";
import { llmBudget } from "@/server/ai/runtime";
import { db } from "@/server/db/client";
import { env } from "@/server/env";
import type { PlannerDeps } from "./graph";

/** Workflow B dependencies for the Next.js runtime (persistent LLM cache, daily budget). */
export const plannerDeps: PlannerDeps = {
  env,
  llmCache: new SqliteLlmCache(db),
  budget: llmBudget,
};
