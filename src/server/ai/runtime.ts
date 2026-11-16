import "server-only";
import { db } from "@/server/db/client";
import { env } from "@/server/env";
import { LlmBudget } from "./budget";

/** The app's daily LLM budget (one per Next.js process, counted in the shared database). */
export const llmBudget = new LlmBudget(db, env.LLM_DAILY_BUDGET);
