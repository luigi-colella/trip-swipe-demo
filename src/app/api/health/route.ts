import { connection } from "next/server";
import { sqlite } from "@/server/db/client";
import { env } from "@/server/env";

export async function GET() {
  // better-sqlite3 is synchronous: without connection() Next would prerender this at build time.
  await connection();
  const { version } = sqlite.prepare("SELECT sqlite_version() AS version").get() as {
    version: string;
  };
  const tables = sqlite
    .prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table'")
    .get() as { n: number };
  return Response.json({
    status: "ok",
    llmMode: env.LLM_MODE,
    sqlite: version,
    tables: tables.n,
    time: new Date().toISOString(),
  });
}
