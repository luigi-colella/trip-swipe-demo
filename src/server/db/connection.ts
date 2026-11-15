import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema";

export type AppDatabase = ReturnType<typeof openDatabase>["db"];

/**
 * Opens a SQLite database tuned for a small multi-user web app:
 * WAL lets readers proceed during writes, busy_timeout waits instead of failing on locks.
 * Pure function (no env, no singletons) so tests can open throwaway databases.
 */
export function openDatabase(filePath: string) {
  if (filePath !== ":memory:") {
    fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
  }
  const sqlite = new Database(filePath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("busy_timeout = 5000");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("synchronous = NORMAL");

  const db = drizzle(sqlite, { schema });
  return { sqlite, db };
}

export const MIGRATIONS_FOLDER = path.resolve(process.cwd(), "drizzle");

export function runMigrations(db: AppDatabase, migrationsFolder = MIGRATIONS_FOLDER) {
  migrate(db, { migrationsFolder });
}
