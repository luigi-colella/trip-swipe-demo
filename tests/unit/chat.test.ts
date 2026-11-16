import {
  AIMessage,
  AIMessageChunk,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from "@langchain/core/messages";
import { describe, expect, it } from "vitest";
import {
  ChatRequestSchema,
  MAX_CHAT_INPUT,
  MAX_HISTORY_TEXT,
  MAX_HOME_HISTORY,
  messageText,
  toHomeHistory,
  tripUpdatePath,
  type ChatMessage,
} from "@/lib/chat";
import { deckVersion, type DeckEntry } from "@/lib/deck";
import type { PlaceCard } from "@/lib/places";
import { recentMessages, textOnly } from "@/server/agent/agent";
import { describeMiss, matchByName } from "@/server/agent/match";
import { FAKE_AGENT_HELP, FakeAgentModel, fakeAgentReply } from "@/server/ai/fake-agent";
import { agentTripContext, plannerMessages } from "@/server/ai/prompts";
import { insertIntoItinerary } from "@/server/itinerary/insert";
import type { ItineraryData } from "@/lib/itinerary";

const TRIP = "0b8f3c1e-7d2a-4f6b-9c3e-1a2b3c4d5e6f";

const msg = (role: ChatMessage["role"], ...texts: string[]): ChatMessage => ({
  id: crypto.randomUUID(),
  role,
  parts: texts.map((text) => ({ type: "text", text })),
});

describe("chat contract", () => {
  it("validates requests: trims, bounds the text and the home history", () => {
    expect(ChatRequestSchema.parse({ text: "  hi " })).toEqual({ text: "hi", history: [] });
    expect(ChatRequestSchema.safeParse({ text: "   " }).success).toBe(false);
    expect(ChatRequestSchema.safeParse({ text: "x".repeat(MAX_CHAT_INPUT + 1) }).success).toBe(
      false,
    );
    expect(ChatRequestSchema.safeParse({ text: "hi", tripId: "not-a-uuid" }).success).toBe(false);
    const history = Array.from({ length: MAX_HOME_HISTORY + 1 }, () => ({
      role: "user",
      text: "a",
    }));
    expect(ChatRequestSchema.safeParse({ text: "hi", history }).success).toBe(false);
    expect(
      ChatRequestSchema.safeParse({ text: "hi", history: [{ role: "system", text: "x" }] }).success,
    ).toBe(false);
  });

  it("joins the text parts of a message and ignores the others", () => {
    const m: ChatMessage = {
      id: "1",
      role: "assistant",
      parts: [
        { type: "text", text: "Hello " },
        { type: "step-start" },
        { type: "text", text: "there " },
      ],
    };
    expect(messageText(m)).toBe("Hello there");
  });

  it("keeps the last home turns with text, cut to the maximum length", () => {
    const messages = [
      msg("user", "first"),
      msg("assistant"),
      ...Array.from({ length: MAX_HOME_HISTORY }, (_, i) => msg("user", `m${i}`)),
      msg("assistant", "y".repeat(MAX_HISTORY_TEXT + 10)),
    ];
    const history = toHomeHistory(messages);
    expect(history).toHaveLength(MAX_HOME_HISTORY);
    expect(history[0]).toEqual({ role: "user", text: "m1" });
    expect(history.at(-1)).toEqual({ role: "assistant", text: "y".repeat(MAX_HISTORY_TEXT) });
  });

  it("builds navigation paths only for a view and a valid trip ID", () => {
    expect(tripUpdatePath({ tripId: TRIP, view: "itinerary" })).toBe(`/trip/${TRIP}/itinerary`);
    expect(tripUpdatePath({ tripId: TRIP })).toBeNull();
    expect(tripUpdatePath({ tripId: "../../evil", view: "swipe" })).toBeNull();
  });
});

describe("deckVersion", () => {
  const card = (id: string) => ({ id }) as PlaceCard;
  it("changes with the pool size and with any swipe or decision", () => {
    const history: DeckEntry[] = [{ place: card("a"), decision: "like" }];
    const base = deckVersion([card("b")], history);
    expect(deckVersion([card("b")], history)).toBe(base);
    expect(deckVersion([card("b"), card("c")], history)).not.toBe(base);
    expect(deckVersion([card("b")], [{ place: card("a"), decision: "skip" }])).not.toBe(base);
    expect(deckVersion([], [])).toMatch(/^[0-9a-z]+$/);
  });
});

describe("matchByName", () => {
  const places = [
    { name: "Colosseum" },
    { name: "Roman Forum" },
    { name: "Forum Boarium" },
    { name: "Piazza Navona" },
    { name: "Piazza Navona" },
  ];

  it("finds exact names regardless of case, accents and punctuation", () => {
    expect(matchByName(places, "colosseum!")).toEqual({ kind: "found", item: places[0] });
    expect(matchByName([{ name: "Musée d'Orsay" }], "musee d orsay").kind).toBe("found");
  });

  it("accepts a unique partial match in either direction", () => {
    expect(matchByName(places, "roman forum in rome")).toEqual({
      kind: "found",
      item: places[1],
    });
    expect(matchByName(places, "boarium")).toEqual({ kind: "found", item: places[2] });
  });

  it("reports ambiguous and unknown names", () => {
    expect(matchByName(places, "forum")).toEqual({
      kind: "ambiguous",
      items: [places[1], places[2]],
    });
    expect(matchByName(places, "Piazza Navona").kind).toBe("ambiguous");
    expect(matchByName(places, "Louvre")).toEqual({ kind: "none" });
    expect(matchByName(places, "?!")).toEqual({ kind: "none" });
  });

  it("describes misses for the model", () => {
    const many = Array.from({ length: 7 }, (_, i) => ({ name: `Forum ${i}` }));
    expect(describeMiss({ kind: "ambiguous", items: many }, "forum", "planned")).toBe(
      '"forum" matches several places planned: Forum 0, Forum 1, Forum 2, Forum 3, Forum 4. Ask which one.',
    );
    expect(describeMiss({ kind: "none" }, "x", "in the trip")).toBe(
      'No place called "x" in the trip.',
    );
  });
});

describe("insertIntoItinerary", () => {
  // Three places a few hundred metres apart and one far away (Ostia Antica).
  const known = new Map([
    ["a", { lat: 41.8902, lon: 12.4922, visitMinutes: 60 }],
    ["b", { lat: 41.8925, lon: 12.4853, visitMinutes: 60 }],
    ["far", { lat: 41.7556, lon: 12.2919, visitMinutes: 60 }],
  ]);
  const data: ItineraryData = {
    days: [
      {
        title: "Near",
        stops: [
          { placeId: "a", tip: "tip" },
          { placeId: "b", tip: null },
        ],
      },
      { title: "Far", stops: [{ placeId: "far", tip: null }] },
    ],
    excluded: [{ placeId: "new", reason: "Removed by you." }],
    source: "ai",
  };
  const place = { id: "new", lat: 41.8915, lon: 12.489, visitMinutes: 30, must: false };

  it("inserts where it adds the fewest minutes and takes the place out of excluded", () => {
    const result = insertIntoItinerary(data, place, known, 480, "No room.");
    expect(result).toMatchObject({ kind: "added", day: 0 });
    if (result.kind !== "added") throw new Error("unreachable");
    expect(result.data.days[0].stops.map((s) => s.placeId)).toEqual(["a", "new", "b"]);
    expect(result.data.days[0].stops[0].tip).toBe("tip");
    expect(result.data.days[1]).toBe(data.days[1]);
    expect(result.data.excluded).toEqual([]);
  });

  it("reports a place that is already planned", () => {
    expect(insertIntoItinerary(data, { ...place, id: "far" }, known, 480, "x")).toEqual({
      kind: "already-planned",
      day: 1,
    });
  });

  it("lists a liked place that fits nowhere as excluded", () => {
    const result = insertIntoItinerary(data, place, known, 100, "No room.");
    expect(result).toEqual({
      kind: "excluded",
      data: { ...data, excluded: [{ placeId: "new", reason: "No room." }] },
    });
  });

  it("puts a must-see that fits nowhere where it overflows least", () => {
    // Day 2 would add a long transit leg to Ostia: Day 1 overflows less.
    const result = insertIntoItinerary(data, { ...place, must: true }, known, 100, "x");
    expect(result).toMatchObject({ kind: "added", day: 0 });
  });

  it("ignores stops whose place is unknown", () => {
    const partial = new Map([["a", known.get("a")!]]);
    const result = insertIntoItinerary(data, place, partial, 480, "x");
    expect(result.kind).toBe("added");
  });
});

describe("fake agent model", () => {
  const reply = (text: string) => fakeAgentReply([new SystemMessage("s"), new HumanMessage(text)]);
  const call = (text: string) => reply(text).tool_calls?.[0];

  it("maps requests to tool calls", () => {
    expect(call("Move the Colosseum to day 2.")).toMatchObject({
      name: "edit_itinerary",
      args: { ops: [{ action: "move_to_day", place: "the colosseum", day: 2 }] },
    });
    expect(call("Plan a new plan please")?.name).toBe("regenerate_itinerary");
    expect(call("Plan a new itinerary")?.name).toBe("regenerate_itinerary");
    expect(call("Find more places")?.name).toBe("find_more_places");
    expect(call("Add Pantheon")).toMatchObject({
      name: "add_place",
      args: { name: "pantheon", must_see: false },
    });
    expect(call("add Pantheon as a must-see!")).toMatchObject({
      args: { name: "pantheon", must_see: true },
    });
    expect(call("remove trevi fountain")).toMatchObject({
      name: "remove_place",
      args: { name: "trevi fountain" },
    });
    expect(call("Plan a trip to Rome for 2 days")).toMatchObject({
      name: "set_trip",
      args: { city: "rome", days: 2 },
    });
    expect(call("a trip to Paris")).toMatchObject({ name: "set_trip", args: { city: "paris" } });
    expect(call("make it 4 days")).toMatchObject({ name: "set_trip", args: { days: 4 } });
  });

  it("answers with help text otherwise, and repeats tool results after tools ran", () => {
    expect(reply("hello").content).toBe(FAKE_AGENT_HELP);
    const after = fakeAgentReply([
      new HumanMessage("x"),
      new ToolMessage({ content: "First.", tool_call_id: "1" }),
      new ToolMessage({ content: [{ type: "text", text: "Second." }], tool_call_id: "2" }),
    ]);
    expect(after.content).toBe("First. Second.");
    const fromBlocks = fakeAgentReply([
      new HumanMessage({
        content: [
          { type: "image_url", image_url: "x" },
          { type: "text", text: "find more" },
        ],
      }),
    ]);
    expect(fromBlocks.tool_calls?.[0].name).toBe("find_more_places");
  });

  it("works as a chat model, with or without streaming", async () => {
    const model = new FakeAgentModel();
    expect(model._llmType()).toBe("fake-agent");
    expect(model.bindTools()).toBe(model);
    expect((await model.invoke([new HumanMessage("hello")])).content).toBe(FAKE_AGENT_HELP);

    let text = "";
    for await (const chunk of await model.stream([new HumanMessage("hello")])) {
      text += chunk.content as string;
    }
    expect(text).toBe(FAKE_AGENT_HELP);

    const chunks: AIMessageChunk[] = [];
    for await (const chunk of await model.stream([new HumanMessage("find more places")])) {
      chunks.push(chunk);
    }
    expect(chunks).toHaveLength(1);
    expect(chunks[0].tool_call_chunks?.[0]).toMatchObject({ name: "find_more_places", args: "{}" });
  });
});

describe("agent helpers", () => {
  it("keeps the recent messages from a user message on", () => {
    const h1 = new HumanMessage("1");
    const tool = new ToolMessage({ content: "t", tool_call_id: "x" });
    const ai = new AIMessage("a");
    const h2 = new HumanMessage("2");
    expect(recentMessages([h1, tool, ai, h2, ai], 4)).toEqual([h2, ai]);
    expect(recentMessages([h1, ai], 4)).toEqual([h1, ai]);
    expect(recentMessages([tool, ai], 4)).toEqual([tool, ai]);
  });

  it("copies conversations as user and assistant text only", () => {
    const copy = textOnly([
      new SystemMessage("system"),
      new HumanMessage(" hi "),
      new AIMessage({
        content: "",
        tool_calls: [{ name: "x", args: {}, id: "1", type: "tool_call" }],
      }),
      new ToolMessage({ content: "done", tool_call_id: "1" }),
      new AIMessage("Done."),
    ]);
    expect(copy.map((m) => [m.type, m.text])).toEqual([
      ["human", "hi"],
      ["ai", "Done."],
    ]);
  });
});

describe("prompts", () => {
  const base = {
    city: "Rome",
    country: "Italy",
    days: 1,
    pace: "balanced",
    budgetMinutes: 480,
    places: [],
    draft: [[]],
  };
  it("adds the traveller's wishes to the planner prompt as delimited data", () => {
    const [, human] = plannerMessages({ ...base, instructions: "No museums" });
    expect(human[1]).toContain("<request>No museums</request>");
    expect(plannerMessages(base)[1][1]).not.toContain("<request>");
  });

  it("wraps the trip snapshot for the agent", () => {
    expect(agentTripContext("City: Rome")).toBe(
      "\n\nCurrent trip state:\n<trip>\nCity: Rome\n</trip>",
    );
  });
});
