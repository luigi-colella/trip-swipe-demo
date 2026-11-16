import "server-only";
import { SqliteLlmCache } from "@/server/ai/cache";
import { db } from "@/server/db/client";
import { env } from "@/server/env";
import type { PlannerDeps } from "./graph";

/** Workflow B dependencies for the Next.js runtime (persistent exact-match LLM cache). */
export const plannerDeps: PlannerDeps = { env, llmCache: new SqliteLlmCache(db) };
