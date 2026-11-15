/**
 * M0 spike: verifies that the configured OpenRouter free model supports what the app needs
 * (plain chat, tool calling, structured output).
 * Requires OPENROUTER_API_KEY in .env.local. Uses 3 requests of the daily free quota.
 * Usage: npm run spike:llm
 */
import { tool } from "@langchain/core/tools";
import type { AIMessage } from "@langchain/core/messages";
import { z } from "zod";
import { createOpenRouterModel } from "../src/server/ai/models";
import { parseEnv } from "../src/server/env-schema";

const env = parseEnv({ ...process.env, LLM_MODE: "live" });

const addPlace = tool(async ({ name }) => `added ${name}`, {
  name: "add_place",
  description: "Add a tourist attraction to the user's trip.",
  schema: z.object({ name: z.string().describe("Attraction name, e.g. 'Colosseum'") }),
});

const Attractions = z.object({
  attractions: z
    .array(
      z.object({
        name: z.string(),
        wikiTitle: z.string().describe("Exact English Wikipedia article title"),
        category: z.string(),
        visitMinutes: z.number().int(),
      }),
    )
    .min(3)
    .max(5),
});

type Check = { check: string; ok: boolean; ms: number; detail: string };
const results: Check[] = [];

async function run(check: string, fn: () => Promise<string>) {
  const t0 = Date.now();
  try {
    const detail = await fn();
    results.push({ check, ok: true, ms: Date.now() - t0, detail });
  } catch (err) {
    results.push({ check, ok: false, ms: Date.now() - t0, detail: String(err).slice(0, 160) });
  }
}

async function main() {
  console.log(`Model: ${env.OPENROUTER_MODEL}`);
  const make = () => createOpenRouterModel("agent", env);

  await run("chat", async () => {
    const res = await make().invoke("Reply with exactly: pong");
    return String(res.content).trim().slice(0, 40);
  });

  await run("tool calling", async () => {
    const model = make().bindTools!([addPlace]);
    const res = (await model.invoke("Please add the Trevi Fountain to my trip.")) as AIMessage;
    const call = res.tool_calls?.[0];
    if (!call) throw new Error(`no tool call; content=${String(res.content).slice(0, 80)}`);
    return `${call.name}(${JSON.stringify(call.args)})`;
  });

  await run("structured output", async () => {
    const res = await make()
      .withStructuredOutput(Attractions)
      .invoke("List 3 top tourist attractions in Rome.");
    return Attractions.parse(res)
      .attractions.map((a) => a.wikiTitle)
      .join(" | ");
  });

  console.table(results);
  const failed = results.filter((r) => !r.ok);
  if (failed.length) {
    console.error(`${failed.length} check(s) failed.`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
