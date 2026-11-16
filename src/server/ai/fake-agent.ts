import {
  BaseChatModel,
  type BaseChatModelParams,
} from "@langchain/core/language_models/chat_models";
import { AIMessage, AIMessageChunk, type BaseMessage, ToolMessage } from "@langchain/core/messages";
import { ChatGenerationChunk, type ChatResult } from "@langchain/core/outputs";

/**
 * Scripted chat agent for LLM_MODE=fake (tests, E2E, offline UI work). Plain keyword rules
 * turn the user's last message into a tool call; after the tools ran, it repeats their
 * replies. Enough to exercise the whole loop (tools, checkpointer, streaming) deterministically.
 */

type ToolCall = { name: string; args: Record<string, unknown> };

const RULES: [RegExp, (m: RegExpMatchArray) => ToolCall][] = [
  [
    /\bmove (.+?) to day (\d+)/,
    (m) => ({
      name: "edit_itinerary",
      args: { ops: [{ action: "move_to_day", place: m[1], day: Number(m[2]) }] },
    }),
  ],
  [
    /\b(?:new plan|new itinerary|regenerate|replan|plan the itinerary)\b/,
    () => ({ name: "regenerate_itinerary", args: {} }),
  ],
  [/\b(?:more places|find more)\b/, () => ({ name: "find_more_places", args: {} })],
  [
    /\b(?:add|include) (.+?)( as a must[- ]see)?$/,
    (m) => ({ name: "add_place", args: { name: m[1], must_see: Boolean(m[2]) } }),
  ],
  [/\b(?:remove|drop) (.+)$/, (m) => ({ name: "remove_place", args: { name: m[1] } })],
  [
    /\btrip to ([a-z][a-z .'-]*?)(?: for (\d+) days?)?$/,
    (m) => ({ name: "set_trip", args: { city: m[1], ...(m[2] && { days: Number(m[2]) }) } }),
  ],
  [/\b(\d+) days?$/, (m) => ({ name: "set_trip", args: { days: Number(m[1]) } })],
];

export const FAKE_AGENT_HELP =
  "I can start a trip, add or remove places, move them between days, find more places or plan a new itinerary.";

function text(message: BaseMessage): string {
  return typeof message.content === "string"
    ? message.content
    : message.content.flatMap((c) => (c.type === "text" ? [c.text as string] : [])).join("");
}

/** The scripted reply to a conversation (exported for unit tests). */
export function fakeAgentReply(messages: readonly BaseMessage[]): AIMessage {
  const results: string[] = [];
  for (let i = messages.length - 1; i >= 0 && ToolMessage.isInstance(messages[i]); i--) {
    results.unshift(text(messages[i]));
  }
  if (results.length) return new AIMessage(results.join(" "));

  const said = text(messages.at(-1)!)
    .toLowerCase()
    .replace(/[.!?\s]+$/, "")
    .trim();
  for (const [pattern, toCall] of RULES) {
    const m = said.match(pattern);
    if (m) {
      const call = toCall(m);
      return new AIMessage({
        content: "",
        tool_calls: [{ ...call, id: `call_${crypto.randomUUID()}`, type: "tool_call" }],
      });
    }
  }
  return new AIMessage(FAKE_AGENT_HELP);
}

export class FakeAgentModel extends BaseChatModel {
  constructor(fields: BaseChatModelParams = {}) {
    super(fields);
  }

  _llmType(): string {
    return "fake-agent";
  }

  /** Tools are known by name in the rules above; binding them changes nothing. */
  override bindTools(): this {
    return this;
  }

  async _generate(messages: BaseMessage[]): Promise<ChatResult> {
    const message = fakeAgentReply(messages);
    return { generations: [{ text: text(message), message }] };
  }

  /** Streams text word by word, like a provider (used when the caller streams). */
  async *_streamResponseChunks(messages: BaseMessage[]): AsyncGenerator<ChatGenerationChunk> {
    const message = fakeAgentReply(messages);
    if (message.tool_calls?.length) {
      yield new ChatGenerationChunk({
        text: "",
        message: new AIMessageChunk({
          content: "",
          tool_call_chunks: message.tool_calls.map((c, index) => ({
            type: "tool_call_chunk",
            id: c.id,
            name: c.name,
            args: JSON.stringify(c.args),
            index,
          })),
        }),
      });
      return;
    }
    for (const word of text(message).split(/(?<= )/)) {
      yield new ChatGenerationChunk({ text: word, message: new AIMessageChunk(word) });
    }
  }
}
