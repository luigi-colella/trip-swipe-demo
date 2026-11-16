import "server-only";
import { SqliteLlmCache } from "@/server/ai/cache";
import { db } from "@/server/db/client";
import { env } from "@/server/env";
import type { DiscoveryDeps } from "./discover";

/** Workflow A dependencies for the Next.js runtime (shared connection, persistent LLM cache). */
export const discoveryDeps: DiscoveryDeps = { db, env, llmCache: new SqliteLlmCache(db) };
