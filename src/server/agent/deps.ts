import "server-only";
import { llmBudget } from "@/server/ai/runtime";
import { db, sqlite } from "@/server/db/client";
import { env } from "@/server/env";
import { plannerDeps } from "@/server/itinerary/deps";
import { discoveryDeps } from "@/server/places/deps";
import type { ChatDeps } from "./agent";
import { createCheckpointer } from "./checkpointer";

/** Workflow C dependencies for the Next.js runtime: the checkpointer shares the app database. */
export const chatDeps: ChatDeps = {
  db,
  env,
  checkpointer: createCheckpointer(sqlite),
  discovery: discoveryDeps,
  planner: plannerDeps,
  budget: llmBudget,
};
