/**
 * Applies Drizzle migrations and initialises the LangGraph checkpointer tables.
 * Usage: npm run db:migrate
 */
import { createCheckpointer } from "../src/server/agent/checkpointer";
import { openDatabase, runMigrations } from "../src/server/db/connection";
import { parseEnv } from "../src/server/env-schema";

async function main() {
  const env = parseEnv();
  const { db, sqlite } = openDatabase(env.DATABASE_PATH);

  runMigrations(db);
  // Any read triggers SqliteSaver's idempotent table setup.
  await createCheckpointer(sqlite).getTuple({ configurable: { thread_id: "__setup__" } });

  const tables = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all() as { name: string }[];
  console.log(`Migrated ${env.DATABASE_PATH}. Tables: ${tables.map((t) => t.name).join(", ")}`);
  sqlite.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
