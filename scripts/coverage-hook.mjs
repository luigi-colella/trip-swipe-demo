/**
 * Claude Code Stop hook (.claude/settings.json): when the working tree has changes that can
 * affect test coverage, runs `npm run test:coverage` and blocks the end of the turn (exit 2)
 * until the tests pass with 100% coverage. A fingerprint of the last passing state avoids
 * re-running the suite at every turn when nothing changed since.
 * Manual run: node scripts/coverage-hook.mjs
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const WATCHED = [
  "src",
  "tests/unit",
  "tests/integration",
  "tests/components",
  "tests/helpers",
  "tests/setup",
  "tests/stubs",
  "vitest.config.mts",
];

// Hooks may start in another directory: work from the repository root.
process.chdir(path.join(import.meta.dirname, ".."));

const git = (...args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 << 20 });

const changed = git("status", "--porcelain", "--untracked-files=all", "--", ...WATCHED).trim();
if (!changed) process.exit(0);

// Fingerprint of the changed state: tracked diff plus the content of untracked files.
const hash = createHash("sha256").update(git("diff", "HEAD", "--", ...WATCHED));
for (const file of git("ls-files", "--others", "--exclude-standard", "--", ...WATCHED)
  .split("\n")
  .filter(Boolean)) {
  hash.update(file).update(fs.readFileSync(file));
}
const fingerprint = hash.digest("hex");
const stamp = path.join(git("rev-parse", "--git-dir").trim(), "coverage-hook-pass");
if (fs.existsSync(stamp) && fs.readFileSync(stamp, "utf8") === fingerprint) process.exit(0);

const run = spawnSync("npm", ["run", "test:coverage"], {
  encoding: "utf8",
  shell: process.platform === "win32",
  maxBuffer: 64 << 20,
});
if (run.status === 0) {
  fs.writeFileSync(stamp, fingerprint);
  process.exit(0);
}
const output = `${run.stdout ?? ""}${run.stderr ?? ""}`.trim().split("\n").slice(-60).join("\n");
process.stderr.write(
  `npm run test:coverage failed: tests must pass with 100% coverage of src/ before the work ` +
    `is done. Add or fix tests (edge cases included), then try again.\n\n${output}\n`,
);
process.exit(2);
