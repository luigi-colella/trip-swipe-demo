/**
 * Runs once when a Next.js server starts. In LLM_MODE=fake (the default) only a few cities have
 * built-in attractions: say so up front, so an empty city is not mistaken for a bug.
 */
export async function register() {
  // Node.js only: the edge runtime has no environment validation (and no LLM).
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { parseEnv } = await import("./server/env-schema");
  const { offlineModeHint } = await import("./server/ai/fake");
  let mode;
  try {
    mode = parseEnv().LLM_MODE;
  } catch {
    // An invalid environment is reported by the first request (src/server/env.ts), as before:
    // a startup hint must not stop the server from booting.
    return;
  }
  const hint = offlineModeHint(mode);
  if (hint) console.warn(hint);
}
