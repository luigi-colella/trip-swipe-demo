import {
  BaseCache,
  deserializeStoredGeneration,
  serializeGeneration,
} from "@langchain/core/caches";
import type { StoredGeneration } from "@langchain/core/messages";
import type { Generation } from "@langchain/core/outputs";
import { eq, lte } from "drizzle-orm";
import type { AppDatabase } from "@/server/db/connection";
import { llmCache } from "@/server/db/schema";

const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Exact-match LangChain cache persisted in the `llm_cache` table. The key hashes the full
 * prompt plus the model's identifying params and call options (tools, response format), so
 * any change to the prompt, model or schema is a miss. Used only for the discovery and
 * planner roles (see getChatModel); chat answers depend on trip state and are never cached.
 */
export class SqliteLlmCache extends BaseCache {
  constructor(
    private readonly db: AppDatabase,
    private readonly ttlMs = DEFAULT_TTL_MS,
    private readonly now: () => Date = () => new Date(),
  ) {
    super();
  }

  async lookup(prompt: string, llmKey: string): Promise<Generation[] | null> {
    const key = this.keyEncoder(prompt, llmKey);
    const row = this.db.select().from(llmCache).where(eq(llmCache.key, key)).get();
    if (!row || row.expiresAt.getTime() <= this.now().getTime()) return null;
    return (row.value as StoredGeneration[]).map(deserializeStoredGeneration);
  }

  async update(prompt: string, llmKey: string, value: Generation[]): Promise<void> {
    const key = this.keyEncoder(prompt, llmKey);
    const stored = value.map(serializeGeneration);
    const expiresAt = new Date(this.now().getTime() + this.ttlMs);
    this.db
      .insert(llmCache)
      .values({ key, value: stored, expiresAt })
      .onConflictDoUpdate({ target: llmCache.key, set: { value: stored, expiresAt } })
      .run();
  }
}

export function purgeExpiredLlmCache(db: AppDatabase, now = new Date()): number {
  return db.delete(llmCache).where(lte(llmCache.expiresAt, now)).run().changes;
}
