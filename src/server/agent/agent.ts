import { toUIMessageStream } from "@ai-sdk/langchain";
import type { BaseLanguageModelInput } from "@langchain/core/language_models/base";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage, HumanMessage, SystemMessage, type BaseMessage } from "@langchain/core/messages";
import { RunnableLambda } from "@langchain/core/runnables";
import type { BaseCheckpointSaver } from "@langchain/langgraph";
import type { UIMessageChunk } from "ai";
import {
  createAgent,
  createMiddleware,
  modelCallLimitMiddleware,
  toolCallLimitMiddleware,
} from "langchain";
import { MAX_HOME_HISTORY, type ChatHistoryEntry } from "@/lib/chat";
import { aiBusyText, isAiBusyError, type LlmBudget } from "@/server/ai/budget";
import { FakeAgentModel } from "@/server/ai/fake-agent";
import { getChatModel, type ChatModelOptions } from "@/server/ai/models";
import { AGENT_SYSTEM, agentTripContext } from "@/server/ai/prompts";
import type { Env } from "@/server/env-schema";
import { detectPromptAttack, GUARDRAIL_REPLIES, redactPii, type GuardrailHit } from "./guardrails";
import { buildTripSnapshot } from "./snapshot";
import { createAgentTools } from "./tools";
import type { AgentDeps, AgentSession } from "./trip-ops";

/**
 * Workflow C — the chat agent (§3.3 C): `createAgent` with the trip tools, the trip snapshot
 * injected on every model call, a truncated history and per-turn call limits. A trip's
 * conversation is persisted by the checkpointer (thread_id = trip id); the home page has no
 * trip, so its short history comes with the request and is copied into the trip `set_trip`
 * creates.
 */

export type ChatDeps = AgentDeps & {
  env: Pick<Env, "LLM_MODE" | "OPENROUTER_API_KEY" | "OPENROUTER_MODEL">;
  checkpointer: BaseCheckpointSaver;
  /** Daily LLM budget (LLM10): turns fail with "AI is busy" once it is used up. */
  budget?: LlmBudget;
  /** Overrides the scripted agent used in LLM_MODE=fake (tests). */
  fake?: ChatModelOptions["fake"];
};

export type ChatTurn = {
  tripId?: string;
  text: string;
  history?: ChatHistoryEntry[];
  /** Aborts the run when the client goes away. */
  signal?: AbortSignal;
};

/** LLM10: a turn makes at most this many model calls and tool calls. */
export const MAX_MODEL_CALLS = 4;
export const MAX_TOOL_CALLS = 3;
/** Messages sent to the model: the recent part of the conversation only. */
export const MAX_CONTEXT_MESSAGES = 12;

export const CHAT_ERROR_TEXT = "The assistant is unavailable right now. Please try again.";

export class ChatBusyError extends Error {
  constructor() {
    super("The assistant is still answering your previous message.");
    this.name = "ChatBusyError";
  }
}

/** The last `max` messages, starting at a user message (a tool result needs its call). */
export function recentMessages(messages: readonly BaseMessage[], max: number): BaseMessage[] {
  const recent = messages.slice(-max);
  const start = recent.findIndex((m) => HumanMessage.isInstance(m));
  return start === -1 ? recent : recent.slice(start);
}

/** Injects the current trip state and trims the history before each model call. */
function tripContextMiddleware(deps: AgentDeps, session: AgentSession) {
  return createMiddleware({
    name: "TripContext",
    wrapModelCall: (request, handler) =>
      handler({
        ...request,
        systemMessage: request.systemMessage.concat(
          new SystemMessage(agentTripContext(buildTripSnapshot(deps.db, session.tripId))),
        ),
        messages: recentMessages(request.messages, MAX_CONTEXT_MESSAGES),
      }),
  });
}

export function createChatAgent(
  deps: ChatDeps,
  session: AgentSession,
  checkpointer?: BaseCheckpointSaver,
) {
  const model: BaseChatModel = getChatModel("agent", deps.env, {
    fake: deps.fake ?? (() => new FakeAgentModel()),
    budget: deps.budget,
  });
  return createAgent({
    name: "chat_agent",
    model,
    tools: createAgentTools(deps, session),
    systemPrompt: AGENT_SYSTEM,
    checkpointer,
    middleware: [
      tripContextMiddleware(deps, session),
      modelCallLimitMiddleware({ runLimit: MAX_MODEL_CALLS, exitBehavior: "end" }),
      toolCallLimitMiddleware({ runLimit: MAX_TOOL_CALLS, exitBehavior: "continue" }),
    ],
  });
}

/** Text-only copy of a conversation (tool calls and results are not worth replaying). */
export function textOnly(messages: readonly BaseMessage[]): BaseMessage[] {
  return messages.flatMap((m): BaseMessage[] => {
    const text = m.text.trim();
    if (!text) return [];
    if (HumanMessage.isInstance(m)) return [new HumanMessage(text)];
    if (AIMessage.isInstance(m)) return [new AIMessage(text)];
    return [];
  });
}

/** Starts a new trip's conversation with the turns that led to it. */
async function seedThread(deps: ChatDeps, tripId: string, messages: readonly BaseMessage[]) {
  const seed = textOnly(messages).slice(-MAX_HOME_HISTORY);
  const agent = createChatAgent(deps, { tripId }, deps.checkpointer);
  await agent.graph.updateState({ configurable: { thread_id: tripId } }, { messages: seed });
}

/** One run per thread at a time: concurrent turns would interleave in the checkpointer. */
const running = new Set<string>();

/**
 * Runs one chat turn and streams it as AI SDK UI message chunks. Throws ChatBusyError when the
 * trip's previous turn is still running; later failures become a short error chunk. Messages
 * that trip a guardrail get a standard refusal without calling the model.
 */
export async function streamChatTurn(
  deps: ChatDeps,
  turn: ChatTurn,
): Promise<ReadableStream<UIMessageChunk>> {
  const hit = detectPromptAttack(turn.text);
  if (hit) return refuse(hit, turn.text);

  const threadId = turn.tripId;
  if (threadId && running.has(threadId)) throw new ChatBusyError();

  const session: AgentSession = { tripId: threadId ?? null };
  const input: BaseLanguageModelInput = [
    ...(threadId
      ? []
      : (turn.history ?? []).map((h) =>
          h.role === "user" ? new HumanMessage(redactPii(h.text)) : new AIMessage(h.text),
        )),
    // LLM02: personal data never reaches the model or the checkpointer.
    new HumanMessage(redactPii(turn.text)),
  ];
  const agent = createChatAgent(deps, session, threadId ? deps.checkpointer : undefined);

  if (threadId) running.add(threadId);
  const release = () => {
    if (threadId) running.delete(threadId);
  };
  let failure: unknown;
  try {
    const stream = await agent.stream(
      { messages: input as BaseMessage[] },
      {
        configurable: threadId ? { thread_id: threadId } : {},
        signal: turn.signal,
        streamMode: ["values", "messages", "custom"],
      },
    );
    return sanitizeErrors(
      () => chatErrorText(deps, failure),
      toUIMessageStream<{ messages: BaseMessage[] }>(stream, {
        onFinish: async (state) => {
          release();
          // "values" is streamed, so the final state is always known here.
          if (session.createdTripId) await seedThread(deps, session.createdTripId, state!.messages);
        },
        onError: (err) => {
          release();
          failure = err;
          if (!isAiBusyError(err)) console.error("Chat turn failed", err);
        },
        onAbort: release,
      }),
    );
  } catch (err) {
    release();
    throw err;
  }
}

/** What the user is told when a turn fails: "AI is busy" or a generic message. */
export function chatErrorText(deps: Pick<ChatDeps, "budget">, err: unknown): string {
  return isAiBusyError(err) ? aiBusyText(deps.budget) : CHAT_ERROR_TEXT;
}

/** Provider and internal error messages never reach the browser. */
function sanitizeErrors(
  errorText: () => string,
  stream: ReadableStream<UIMessageChunk>,
): ReadableStream<UIMessageChunk> {
  return stream.pipeThrough(
    new TransformStream<UIMessageChunk, UIMessageChunk>({
      transform(chunk, controller) {
        controller.enqueue(
          chunk.type === "error" ? { type: "error", errorText: errorText() } : chunk,
        );
      },
    }),
  );
}

/**
 * The standard refusal for a guardrail hit, streamed like a reply. It is logged and traced
 * (tagged `guardrail:<hit>` in LangSmith) but not added to the conversation.
 */
async function refuse(hit: GuardrailHit, text: string): Promise<ReadableStream<UIMessageChunk>> {
  console.warn(`Chat guardrail: ${hit}`);
  const reply = await RunnableLambda.from(() => GUARDRAIL_REPLIES[hit]).invoke(text, {
    runName: "chat_guardrail",
    tags: ["guardrail", `guardrail:${hit}`],
  });
  return textReply(reply);
}

/** A complete assistant message as UI message chunks. */
function textReply(text: string): ReadableStream<UIMessageChunk> {
  const id = crypto.randomUUID();
  const chunks: UIMessageChunk[] = [
    { type: "start" },
    { type: "text-start", id },
    { type: "text-delta", id, delta: text },
    { type: "text-end", id },
    { type: "finish" },
  ];
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}
