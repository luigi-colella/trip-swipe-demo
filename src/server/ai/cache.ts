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
 * Model parameters and call options that shape the answer. LangChain's llmKey also carries
 * per-run values (inside a LangGraph node: `executionInfo` with checkpoint and task IDs and a
 * timestamp; the abort `signal`) and the API key, which made every planner run a miss.
 */
const STABLE_KEY_FIELDS: ReadonlySet<string> = new Set([
  "_type",
  "_model",
  "baseURL",
  "model",
  "model_name",
  "temperature",
  "max_tokens",
  "max_completion_tokens",
  "top_p",
  "frequency_penalty",
  "presence_penalty",
  "seed",
  "stop",
  "n",
  "reasoning",
  "reasoning_effort",
  "response_format",
  "ls_structured_output_format",
  "tools",
  "tool_choice",
  "parallel_tool_calls",
  "strict",
]);

/** End (exclusive) of the JSON value that starts at `start`, or -1 when malformed. */
function valueEnd(s: string, start: number): number {
  const first = s[start];
  if (first !== "{" && first !== "[" && first !== '"') {
    // Number, boolean, null or `undefined` (JSON.stringify of a function): no commas inside.
    const comma = s.indexOf(",", start);
    return comma === -1 ? s.length : comma;
  }
  let depth = 0;
  let inString = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
      if (!inString && depth === 0) return i + 1;
    } else if (c === '"') inString = true;
    else if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/**
 * Keeps only STABLE_KEY_FIELDS of LangChain's llmKey (`name:<json>` entries, sorted, joined by
 * commas). An unexpected format keeps the whole key: a miss is safe, a wrong hit is not.
 */
export function stableLlmKey(llmKey: string): string {
  const kept: string[] = [];
  const name = /[A-Za-z_$][\w$]*:/y;
  for (let i = 0; i < llmKey.length;) {
    name.lastIndex = i;
    const match = name.exec(llmKey);
    if (!match) return llmKey;
    const start = i + match[0].length;
    const end = valueEnd(llmKey, start);
    if (end === -1 || (end < llmKey.length && llmKey[end] !== ",")) return llmKey;
    if (STABLE_KEY_FIELDS.has(match[0].slice(0, -1))) kept.push(llmKey.slice(i, end));
    i = end + 1;
  }
  return kept.join(",");
}

/**
 * Exact-match LangChain cache persisted in the `llm_cache` table. The key hashes the full
 * prompt plus the model parameters and call options that shape the answer (model, sampling,
 * tools, response format; see stableLlmKey), so any change to the prompt, model or schema is a
 * miss. Used only for the discovery and planner roles (see getChatModel); chat answers depend
 * on trip state and are never cached.
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
    const key = this.keyEncoder(prompt, stableLlmKey(llmKey));
    const row = this.db.select().from(llmCache).where(eq(llmCache.key, key)).get();
    if (!row || row.expiresAt.getTime() <= this.now().getTime()) return null;
    return (row.value as StoredGeneration[]).map(deserializeStoredGeneration);
  }

  async update(prompt: string, llmKey: string, value: Generation[]): Promise<void> {
    const key = this.keyEncoder(prompt, stableLlmKey(llmKey));
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
