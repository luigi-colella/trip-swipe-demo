import { AIMessage, HumanMessage, type BaseMessage } from "@langchain/core/messages";
import type { BaseCheckpointSaver } from "@langchain/langgraph";
import type { ChatMessage } from "@/lib/chat";
import { defined } from "@/lib/invariant";

/** Messages shown when a trip's chat is opened (older ones stay in the checkpointer). */
export const MAX_SHOWN_MESSAGES = 50;

/** The trip's conversation as chat messages: user and assistant text only. */
export async function loadChatHistory(
  checkpointer: BaseCheckpointSaver,
  tripId: string,
): Promise<ChatMessage[]> {
  const tuple = await checkpointer.getTuple({ configurable: { thread_id: tripId } });
  const messages = (tuple?.checkpoint.channel_values.messages ?? []) as BaseMessage[];
  return messages
    .flatMap((m): ChatMessage[] => {
      const text = m.text.trim();
      const role = HumanMessage.isInstance(m)
        ? "user"
        : AIMessage.isInstance(m)
          ? "assistant"
          : null;
      if (!text || !role) return [];
      return [{ id: defined(m.id, "the message id"), role, parts: [{ type: "text", text }] }];
    })
    .slice(-MAX_SHOWN_MESSAGES);
}
