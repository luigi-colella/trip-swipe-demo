/**
 * LangSmith evals (§10): the itinerary planner on ~10 trips and the chat agent on ~15
 * adversarial prompts, scored by deterministic evaluators (evals/). Runs on a throwaway copy
 * of the app database; trips need their cities seeded (npm run db:seed).
 *
 * Usage:
 *   npm run evals                          # both suites, results uploaded to LangSmith
 *   npm run evals -- --suite trips         # or: adversarial
 *   npm run evals -- --dry-run             # run locally and print the scores, no upload
 *
 * Cost in LLM_MODE=live: up to 3 planner calls per trip and 4 model calls per adversarial
 * prompt that passes the heuristics, all counted against LLM_DAILY_BUDGET: run one suite per
 * day. LLM_MODE=fake makes no provider request (useful with --dry-run to check the setup).
 */
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import { awaitAllCallbacks } from "@langchain/core/callbacks/promises";
import { Client } from "langsmith";
import { evaluate } from "langsmith/evaluation";
import { ADVERSARIAL_CASES, TRIP_CASES, type AdversarialCase } from "../evals/datasets";
import { chatEvaluators, tripEvaluators, type Feedback } from "../evals/evaluators";
import {
  chatCase,
  createEvalContext,
  planTripCase,
  topPlaces,
  type EvalContext,
} from "../evals/targets";
import { LlmBudget } from "../src/server/ai/budget";
import { openDatabase, runMigrations } from "../src/server/db/connection";
import { parseEnv } from "../src/server/env-schema";

type KV = Record<string, unknown>;
/** A suite with its types erased: cases, target and evaluators are checked in evals/. */
type Suite = {
  name: "trips" | "adversarial";
  cases: KV[];
  target: (ctx: EvalContext, input: KV) => Promise<KV>;
  evaluators: ((args: { inputs: KV; outputs: KV }) => Feedback)[];
};

async function main() {
  const { values } = parseArgs({
    options: {
      suite: { type: "string", default: "all" },
      "dry-run": { type: "boolean", default: false },
    },
  });
  const dryRun = values["dry-run"];
  const env = parseEnv();
  if (!dryRun && !env.LANGSMITH_API_KEY) {
    throw new Error("LANGSMITH_API_KEY is required (or use --dry-run)");
  }
  const app = openDatabase(env.DATABASE_PATH);
  runMigrations(app.db);
  const budget = new LlmBudget(app.db, env.LLM_DAILY_BUDGET);
  console.log(`LLM_MODE=${env.LLM_MODE}, LLM requests today: ${budget.used()}/${budget.limit}`);
  const ctx = await createEvalContext(app.sqlite, env, budget);

  // Adversarial turns run on a trip in the first seeded demo city.
  const chatCity = TRIP_CASES.map((c) => c.city).find((c) => topPlaces(ctx.db, c, 1).length);
  const trips = TRIP_CASES.filter((c) => topPlaces(ctx.db, c.city, 1).length > 0);
  const skipped = TRIP_CASES.filter((c) => !trips.includes(c)).map((c) => c.city);
  if (skipped.length) console.warn(`Not seeded, skipped: ${[...new Set(skipped)].join(", ")}`);

  const suites: Suite[] = [
    {
      name: "trips",
      cases: trips as KV[],
      target: planTripCase as unknown as Suite["target"],
      evaluators: tripEvaluators as unknown as Suite["evaluators"],
    },
    {
      name: "adversarial",
      cases: chatCity ? (ADVERSARIAL_CASES as KV[]) : [],
      target: ((c: EvalContext, input: AdversarialCase) =>
        chatCase(c, input, chatCity!)) as unknown as Suite["target"],
      evaluators: chatEvaluators as unknown as Suite["evaluators"],
    },
  ].filter((s) => values.suite === "all" || s.name === values.suite) as Suite[];

  try {
    for (const suite of suites) {
      if (suite.cases.length === 0) {
        console.warn(`${suite.name}: nothing to run (seed a demo city first)`);
        continue;
      }
      if (dryRun) await runLocally(ctx, suite);
      else
        await runOnLangSmith(ctx, suite, env.LLM_MODE === "live" ? env.OPENROUTER_MODEL : "fake");
    }
  } finally {
    ctx.cleanup();
    console.log(`LLM requests today: ${budget.used()}/${budget.limit}`);
    app.sqlite.close();
    await awaitAllCallbacks();
  }
}

/** --dry-run: targets and evaluators in this process, scores printed as a table. */
async function runLocally(ctx: EvalContext, suite: Suite) {
  const rows = [];
  for (const input of suite.cases) {
    const outputs = await suite.target(ctx, input);
    const feedback = suite.evaluators.map((e) => e({ inputs: input, outputs }));
    rows.push({
      case: input.id,
      ...Object.fromEntries(feedback.map((f) => [f.key, f.score])),
      notes: feedback.flatMap((f) => (f.comment ? [`${f.key}: ${f.comment}`] : [])).join("; "),
    });
  }
  console.log(`\n${suite.name}`);
  console.table(rows);
}

/** Uploads the dataset once per content version and runs an experiment on it. */
async function runOnLangSmith(ctx: EvalContext, suite: Suite, model: string) {
  const client = new Client();
  const hash = createHash("sha256").update(JSON.stringify(suite.cases)).digest("hex").slice(0, 8);
  const datasetName = `tripswipe-${suite.name}-${hash}`;
  if (!(await client.hasDataset({ datasetName }))) {
    const dataset = await client.createDataset(datasetName, {
      description: `TripSwipe ${suite.name} eval cases (evals/datasets.ts)`,
    });
    await client.createExamples(suite.cases.map((inputs) => ({ inputs, dataset_id: dataset.id })));
  }
  const results = await evaluate((input: KV) => suite.target(ctx, input), {
    data: datasetName,
    evaluators: suite.evaluators,
    experimentPrefix: `${suite.name}-${model.replace(/[^a-z0-9-]+/gi, "-")}`,
    metadata: { model, suite: suite.name },
    // One at a time: free models are rate limited per minute.
    maxConcurrency: 1,
    client,
  });
  console.log(`${suite.name}: ${results.experimentName}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
