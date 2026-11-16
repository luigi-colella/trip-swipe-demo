import { tool, type ToolRuntime } from "langchain";
import { z } from "zod";
import { MAX_DAYS, MIN_DAYS, PACES } from "@/lib/trip";
import {
  addPlace,
  editItinerary,
  findMorePlaces,
  regenerateItinerary,
  removePlace,
  setTrip,
  type AgentDeps,
  type AgentSession,
  type ToolOutcome,
} from "./trip-ops";

/**
 * The agent's allow-listed tools (LLM06): strict schemas, names instead of IDs, and every
 * call scoped to the session's trip, which only the server sets. A tool that changed the trip
 * streams a `trip-updated` data part so the visual area updates right away.
 */

const PlaceName = z.string().trim().min(1).max(80).describe("Place name as in the trip state");

/** The part of the tool runtime used here: LangGraph's custom stream writer. */
type Runtime = { writer?: ((chunk: unknown) => void) | null };

/** Sends the update to the client and returns the reply for the model. */
function respond(outcome: ToolOutcome, runtime: Runtime): string {
  if (outcome.update) runtime.writer?.({ type: "trip-updated", ...outcome.update });
  return outcome.reply;
}

export function createAgentTools(deps: AgentDeps, session: AgentSession) {
  return [
    tool(
      async (input, runtime: ToolRuntime) => respond(await setTrip(deps, session, input), runtime),
      {
        name: "set_trip",
        description:
          "Start a trip (city required) or change the current trip's days, pace or interests. A different city starts a new trip.",
        schema: z.object({
          city: z.string().trim().min(2).max(80).optional().describe("City name, e.g. Rome"),
          days: z.number().int().min(MIN_DAYS).max(MAX_DAYS).optional(),
          pace: z.enum(PACES).optional(),
          interests: z.array(z.string().max(30)).max(13).optional(),
        }),
      },
    ),
    tool(
      async (_input, runtime: ToolRuntime) => respond(await findMorePlaces(deps, session), runtime),
      {
        name: "find_more_places",
        description: "Find more attractions in the trip's city and add them to the swipe deck.",
        schema: z.object({}),
      },
    ),
    tool(
      (input, runtime: ToolRuntime) =>
        respond(addPlace(deps, session, { name: input.name, mustSee: input.must_see }), runtime),
      {
        name: "add_place",
        description:
          "Add one of the city's places to the shortlist and, if there is an itinerary, to the best day.",
        schema: z.object({ name: PlaceName, must_see: z.boolean().optional() }),
      },
    ),
    tool((input, runtime: ToolRuntime) => respond(removePlace(deps, session, input), runtime), {
      name: "remove_place",
      description: "Remove a place from the itinerary, or from the shortlist if not planned yet.",
      schema: z.object({ name: PlaceName }),
    }),
    tool(
      (input, runtime: ToolRuntime) => respond(editItinerary(deps, session, input.ops), runtime),
      {
        name: "edit_itinerary",
        description: "Reorder stops within a day or move them to another day of the itinerary.",
        schema: z.object({
          ops: z
            .array(
              z.discriminatedUnion("action", [
                z.object({ action: z.enum(["move_up", "move_down"]), place: PlaceName }),
                z.object({
                  action: z.literal("move_to_day"),
                  place: PlaceName,
                  day: z.number().int().min(1).max(MAX_DAYS).describe("Day number, from 1"),
                }),
              ]),
            )
            .min(1)
            .max(10),
        }),
      },
    ),
    tool(
      async (input, runtime: ToolRuntime) =>
        respond(await regenerateItinerary(deps, session, input), runtime),
      {
        name: "regenerate_itinerary",
        description:
          "Plan the itinerary from the shortlist, or a new alternative one, following the user's wishes.",
        schema: z.object({
          instructions: z
            .string()
            .max(300)
            .optional()
            .describe("The user's wishes for the plan, in their words"),
        }),
      },
    ),
  ];
}
