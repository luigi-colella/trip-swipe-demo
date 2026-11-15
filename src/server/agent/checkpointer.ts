import type Database from "better-sqlite3";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";

/**
 * LangGraph checkpointer stored in the same SQLite file as the app data
 * (tables `checkpoints` and `writes`, created on first use). thread_id = trip id.
 */
export function createCheckpointer(sqlite: Database.Database) {
  return new SqliteSaver(sqlite);
}
