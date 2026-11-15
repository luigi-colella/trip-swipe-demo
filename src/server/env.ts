import "server-only";
import { parseEnv } from "./env-schema";

export type { Env } from "./env-schema";

/** Validated server environment (Next.js runtime only; scripts call parseEnv directly). */
export const env = parseEnv();
