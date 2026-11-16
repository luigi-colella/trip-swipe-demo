/**
 * Copies the local database (data/app.db) to a throwaway data/demo.db for the demo recording,
 * so the recorded trip never touches real data. The demo needs Rome's real place pool (photos
 * included): seed it once with `npm run db:seed -- --cities Rome` (1 live LLM request).
 * Usage (from scripts/demo/playwright.config.ts): node --import tsx scripts/demo/prepare-db.ts
 */
import { existsSync, rmSync } from "node:fs";
import Database from "better-sqlite3";

const SOURCE = "data/app.db";
const TARGET = "data/demo.db";

function main() {
  if (!existsSync(SOURCE)) {
    throw new Error(`${SOURCE} not found: run npm run db:migrate and seed Rome first.`);
  }
  const source = new Database(SOURCE, { readonly: true });
  const { places } = source
    .prepare(
      "select count(*) as places from places p join cities c on c.id = p.city_id where c.name = 'Rome'",
    )
    .get() as { places: number };
  if (places === 0) {
    source.close();
    throw new Error("Rome has no places: run npm run db:seed -- --cities Rome first.");
  }
  for (const suffix of ["", "-wal", "-shm"]) rmSync(TARGET + suffix, { force: true });
  // A consistent single-file copy, WAL content included.
  source.prepare("vacuum into ?").run(TARGET);
  source.close();
  console.log(`Copied ${SOURCE} to ${TARGET} (Rome: ${places} places).`);
}

main();
