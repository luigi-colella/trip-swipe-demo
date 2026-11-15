import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { FakeListChatModel } from "@langchain/core/utils/testing";
import { END, MessagesAnnotation, START, StateGraph } from "@langchain/langgraph";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCheckpointer } from "@/server/agent/checkpointer";
import { openDatabase } from "@/server/db/connection";
import { createTestDatabase } from "../helpers/db";

let t: ReturnType<typeof createTestDatabase>;
beforeEach(() => {
  t = createTestDatabase();
});
afterEach(() => t.cleanup());

function buildGraph(sqlite: Parameters<typeof createCheckpointer>[0]) {
  const model = new FakeListChatModel({ responses: ["first answer", "second answer"] });
  return new StateGraph(MessagesAnnotation)
    .addNode("chat", async (state) => ({ messages: [await model.invoke(state.messages)] }))
    .addEdge(START, "chat")
    .addEdge("chat", END)
    .compile({ checkpointer: createCheckpointer(sqlite) });
}

describe("LangGraph SqliteSaver", () => {
  it("persists conversation history per thread, across connections", async () => {
    const config = { configurable: { thread_id: "trip-123" } };

    await buildGraph(t.sqlite).invoke({ messages: [new HumanMessage("hi")] }, config);

    // Simulate a server restart: new connection to the same file.
    const reopened = openDatabase(t.file);
    try {
      const state = await buildGraph(reopened.sqlite).invoke(
        { messages: [new HumanMessage("and then?")] },
        config,
      );
      expect(state.messages).toHaveLength(4);
      expect(state.messages[1]).toBeInstanceOf(AIMessage);
      expect(state.messages.map((m) => m.content)).toEqual([
        "hi",
        "first answer",
        "and then?",
        "first answer", // fresh fake model instance restarts its response list
      ]);
    } finally {
      reopened.sqlite.close();
    }
  });

  it("keeps threads isolated", async () => {
    const graph = buildGraph(t.sqlite);
    await graph.invoke(
      { messages: [new HumanMessage("a")] },
      { configurable: { thread_id: "t1" } },
    );
    const other = await graph.invoke(
      { messages: [new HumanMessage("b")] },
      { configurable: { thread_id: "t2" } },
    );
    expect(other.messages.map((m) => m.content)[0]).toBe("b");
    expect(other.messages).toHaveLength(2);
  });
});
