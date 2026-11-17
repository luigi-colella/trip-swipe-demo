import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase, runMigrations } from "@/server/db/connection";

/** Fresh migrated SQLite file in the OS temp dir; call cleanup() in afterEach. */
export function createTestDatabase() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "trip-swipe-test-"));
  const file = path.join(dir, "test.db");
  const conn = openDatabase(file);
  runMigrations(conn.db);
  return {
    ...conn,
    file,
    cleanup: () => {
      conn.sqlite.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Empties every app table (for test files that share one database across tests). */
export function resetDatabase(sqlite: ReturnType<typeof openDatabase>["sqlite"]) {
  sqlite.exec(
    ["itineraries", "swipes", "trips", "places", "cities", "http_cache", "llm_cache", "rate_limits"]
      .map((table) => `DELETE FROM ${table};`)
      .join(" "),
  );
}
