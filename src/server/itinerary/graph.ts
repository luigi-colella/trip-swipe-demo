import type { BaseCache } from "@langchain/core/caches";
import type { Runnable } from "@langchain/core/runnables";
import { OutputParserException } from "@langchain/core/output_parsers";
import { FakeListChatModel } from "@langchain/core/utils/testing";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { ZodError } from "zod";
import { paceMinutes, type ItineraryData } from "@/lib/itinerary";
import { PACE_LABELS, type Pace } from "@/lib/trip";
import { fakePlannerResponse } from "@/server/ai/fake";
import { getChatModel, type ChatModelOptions } from "@/server/ai/models";
import {
  PlannerOutputSchema,
  plannerMessages,
  plannerRepairMessage,
  type PlannerOutput,
} from "@/server/ai/prompts";
import type { Env } from "@/server/env-schema";
import { buildDraftItinerary, type PlannerPlace } from "./fallback";
import { validatePlan } from "./validate";

/**
 * Workflow B — itinerary subgraph (§3.3 B):
 * prepare → cluster → plan (LLM) → validate ─ok→ END
 *                        ↑______errors (max 2 repairs)__│
 *                     plan/validate failing for good → fallback (deterministic) → END
 * The graph only computes; saving the result as a new version is the caller's job.
 */

export type PlannerDeps = {
  env: Pick<Env, "LLM_MODE" | "OPENROUTER_API_KEY" | "OPENROUTER_MODEL">;
  llmCache?: BaseCache;
  /** Overrides the scripted planner used in LLM_MODE=fake (tests). */
  fake?: ChatModelOptions["fake"];
};

export type PlannerInput = {
  city: { name: string; country: string };
  days: number;
  pace: Pace;
  /** The shortlist: liked and must-see places. */
  places: readonly PlannerPlace[];
  /** Current itinerary, when the traveller asks for a different one (bypasses the cache). */
  previous?: ItineraryData;
};

export type PlannerResult = {
  data: ItineraryData;
  /** LLM calls made (0 when the provider failed before answering). */
  attempts: number;
  /** Validation errors of the last AI attempt, when the fallback was used. */
  errors: string[];
};

/** First answer + up to 2 repairs. */
export const MAX_PLAN_ATTEMPTS = 3;

const State = Annotation.Root({
  input: Annotation<PlannerInput>,
  budgetMinutes: Annotation<number>,
  /** Short alias (P1, P2…) → place; aliases keep IDs out of the prompt and easy to copy. */
  aliases: Annotation<Record<string, PlannerPlace>>,
  draft: Annotation<ItineraryData>,
  conversation: Annotation<[string, string][]>,
  output: Annotation<PlannerOutput | null>,
  attempts: Annotation<number>,
  errors: Annotation<string[]>,
  providerFailed: Annotation<boolean>,
  result: Annotation<ItineraryData | null>,
});
type S = typeof State.State;

/** Repairable: the model answered, but not with the expected structure. */
function isOutputError(err: unknown): boolean {
  return (
    err instanceof OutputParserException || err instanceof SyntaxError || err instanceof ZodError
  );
}

export function buildPlannerGraph(deps: PlannerDeps) {
  let model: Runnable<[string, string][], PlannerOutput> | undefined;
  const aliasOf = (s: S) => new Map(Object.entries(s.aliases).map(([a, p]) => [p.id, a]));
  const toAliases = (s: S, data: ItineraryData) => {
    const alias = aliasOf(s);
    return data.days.map((d) => d.stops.flatMap((x) => alias.get(x.placeId) ?? []));
  };

  const prepare = (s: S): Partial<S> => {
    const ordered = [...s.input.places].sort(
      (a, b) => Number(b.must) - Number(a.must) || b.popularity - a.popularity,
    );
    return {
      budgetMinutes: paceMinutes(s.input.pace),
      aliases: Object.fromEntries(ordered.map((p, i) => [`P${i + 1}`, p])),
      attempts: 0,
      errors: [],
      output: null,
      providerFailed: false,
      result: null,
    };
  };

  const cluster = (s: S): Partial<S> => {
    const draft = buildDraftItinerary({
      places: s.input.places,
      days: s.input.days,
      pace: s.input.pace,
      budgetMinutes: s.budgetMinutes,
    });
    const places = Object.entries(s.aliases).map(([id, p]) => ({
      id,
      name: p.name,
      category: p.category,
      visitMinutes: p.visitMinutes,
      must: p.must,
    }));
    const conversation = plannerMessages({
      city: s.input.city.name,
      country: s.input.city.country,
      days: s.input.days,
      pace: PACE_LABELS[s.input.pace].toLowerCase(),
      budgetMinutes: s.budgetMinutes,
      places,
      draft: toAliases(s, draft),
      previous: s.input.previous ? toAliases(s, s.input.previous) : undefined,
    });
    return { draft, conversation };
  };

  const plan = async (s: S): Promise<Partial<S>> => {
    if (!model) {
      const alias = aliasOf(s);
      const fakeDraft = {
        days: s.draft.days.map((d) => ({
          title: d.title,
          ids: d.stops.map((x) => alias.get(x.placeId)!),
        })),
        excluded: s.draft.excluded.map((x) => ({ id: alias.get(x.placeId)!, reason: x.reason })),
      };
      model = getChatModel("planner", deps.env, {
        fake:
          deps.fake ??
          (() => new FakeListChatModel({ responses: [fakePlannerResponse(fakeDraft)] })),
        // A request for an alternative must not be answered from the cache.
        cache: s.input.previous ? undefined : deps.llmCache,
      })
        .withStructuredOutput(PlannerOutputSchema, { name: "itinerary" })
        .withConfig({ runName: "plan_itinerary", tags: ["workflow-b"] });
    }
    const attempts = s.attempts + 1;
    try {
      const output = PlannerOutputSchema.parse(await model.invoke(s.conversation));
      return { attempts, output };
    } catch (err) {
      if (!isOutputError(err)) {
        console.error("Itinerary planner unavailable, using the deterministic plan", err);
        return { attempts, providerFailed: true, output: null };
      }
      const errors = ["Your reply was not valid JSON matching the required structure."];
      return {
        attempts,
        output: null,
        errors,
        conversation: [...s.conversation, plannerRepairMessage(errors)],
      };
    }
  };

  const validate = (s: S): Partial<S> => {
    if (!s.output) return {};
    const places = new Map(Object.entries(s.aliases));
    const { data, errors } = validatePlan(s.output, {
      places,
      days: s.input.days,
      budgetMinutes: s.budgetMinutes,
    });
    if (data) return { result: data, errors: [] };
    return {
      errors,
      conversation: [
        ...s.conversation,
        ["ai", JSON.stringify(s.output)],
        plannerRepairMessage(errors),
      ],
    };
  };

  const fallback = (s: S): Partial<S> => ({ result: s.draft });

  return new StateGraph(State)
    .addNode("prepare", prepare)
    .addNode("cluster", cluster)
    .addNode("plan", plan)
    .addNode("validate", validate)
    .addNode("fallback", fallback)
    .addEdge(START, "prepare")
    .addEdge("prepare", "cluster")
    .addEdge("cluster", "plan")
    .addConditionalEdges("plan", (s: S) => (s.providerFailed ? "fallback" : "validate"), [
      "fallback",
      "validate",
    ])
    .addConditionalEdges(
      "validate",
      (s: S) => {
        if (s.result) return END;
        return s.attempts < MAX_PLAN_ATTEMPTS ? "plan" : "fallback";
      },
      ["plan", "fallback", END],
    )
    .addEdge("fallback", END)
    .compile();
}

/** Runs workflow B. Never throws for model problems: the deterministic plan is the floor. */
export async function planItinerary(
  input: PlannerInput,
  deps: PlannerDeps,
): Promise<PlannerResult> {
  if (input.places.length === 0) throw new Error("Cannot plan an empty shortlist.");
  const state = await buildPlannerGraph(deps).invoke(
    { input },
    { runName: "itinerary_planner", tags: ["workflow-b"], metadata: { days: input.days } },
  );
  return {
    data: state.result!,
    attempts: state.attempts,
    errors: state.result?.source === "fallback" ? state.errors : [],
  };
}
