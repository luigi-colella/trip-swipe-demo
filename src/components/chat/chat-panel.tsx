"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useChat } from "@ai-sdk/react";
import { ArrowUp, Check, LoaderCircle, RotateCcw, Sparkles, Square } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MAX_CHAT_INPUT, tripUpdatePath, type ChatMessage, type TripUpdate } from "@/lib/chat";
import { loadChatHistoryAction } from "@/server/actions/chat";
import { getChatSession, loadHistory, onTripUpdate } from "./chat-session";
import { ChatMarkdown } from "./chat-markdown";
import { ChatSkeleton } from "./chat-skeleton";
import { requestErrorText } from "@/components/call-server";

/**
 * F6 – The conversation with the trip agent (lazy-loaded: it carries the AI SDK client).
 * Replies stream in as plain text; tool steps show as short status lines; a trip update
 * refreshes the visual area or opens the step that shows it.
 */

const TOOL_LABELS: Record<string, [running: string, done: string]> = {
  set_trip: ["Updating the trip…", "Trip updated"],
  find_more_places: ["Finding more places…", "Places found"],
  add_place: ["Adding the place…", "Place added"],
  remove_place: ["Removing the place…", "Place removed"],
  edit_itinerary: ["Editing the itinerary…", "Itinerary edited"],
  regenerate_itinerary: ["Planning the itinerary…", "Itinerary planned"],
};

const HOME_SUGGESTIONS = ["Plan a trip to Rome for 3 days", "Plan a trip to Paris for 2 days"];
const TRIP_SUGGESTIONS = ["Find more places", "Plan a new itinerary"];

export default function ChatPanel({ tripId }: { tripId: string | null }) {
  const router = useRouter();
  const [session] = useState(() => getChatSession(tripId));
  const { messages, sendMessage, status, error, regenerate, stop } = useChat({
    chat: session.chat,
  });
  const [loadingHistory, setLoadingHistory] = useState(!session.historyLoaded);
  const [input, setInput] = useState("");
  const log = useRef<HTMLDivElement>(null);
  const busy = status === "submitted" || status === "streaming";

  useEffect(() => {
    const apply = (update: TripUpdate) => {
      const path = tripUpdatePath(update);
      if (path && window.location.pathname !== path) router.push(path);
      else router.refresh();
    };
    return onTripUpdate(session, apply);
  }, [session, router]);

  useEffect(() => {
    if (session.historyLoaded) return;
    let mounted = true;
    void loadHistory(session, loadChatHistoryAction).then(() => {
      if (mounted) setLoadingHistory(false);
    });
    return () => {
      mounted = false;
    };
  }, [session]);

  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight });
  }, [messages, status]);

  function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    void sendMessage({ text: trimmed });
    setInput("");
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    send(input);
  }

  const suggestions = session.tripId ? TRIP_SUGGESTIONS : HOME_SUGGESTIONS;
  const waiting = status === "submitted";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={log}
        role="log"
        aria-live="polite"
        aria-label="Conversation"
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4"
      >
        {loadingHistory ? (
          <ChatSkeleton lines={2} />
        ) : messages.length === 0 ? (
          <div className="flex flex-col gap-3 text-sm">
            <p className="text-muted-foreground">
              {session.tripId
                ? "Ask me to add or remove places, move them between days or plan a new itinerary."
                : "Tell me where you want to go and for how many days, and I'll set up the trip."}
            </p>
            <div className="flex flex-wrap gap-2">
              {suggestions.map((s) => (
                <Button key={s} variant="outline" size="sm" onClick={() => send(s)}>
                  {s}
                </Button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m) => <ChatBubble key={m.id} message={m} />)
        )}
        {waiting && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
            Thinking…
          </p>
        )}
        {error && (
          <div
            role="alert"
            className="flex items-center gap-2 rounded-lg border border-destructive/30 p-2 text-sm"
          >
            <span className="flex-1">{requestErrorText(error)}</span>
            <Button variant="outline" size="sm" onClick={() => void regenerate()}>
              <RotateCcw aria-hidden /> Retry
            </Button>
          </div>
        )}
      </div>

      <form
        onSubmit={submit}
        className="flex flex-col gap-1 border-t p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
      >
        <div className="flex items-center gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            maxLength={MAX_CHAT_INPUT}
            placeholder="Ask the trip assistant…"
            aria-label="Message"
            className="h-9"
          />
          {busy ? (
            <Button type="button" size="icon" className="size-9" onClick={() => void stop()}>
              <Square aria-hidden />
              <span className="sr-only">Stop</span>
            </Button>
          ) : (
            <Button type="submit" size="icon" className="size-9" disabled={!input.trim()}>
              <ArrowUp aria-hidden />
              <span className="sr-only">Send</span>
            </Button>
          )}
        </div>
        <p className="flex justify-between gap-2 text-xs text-muted-foreground">
          <span>
            AI-generated replies can be wrong. Free AI models may use chats for training: don&apos;t
            share personal data.
          </span>
          {input.length > MAX_CHAT_INPUT - 100 && (
            <span>
              {input.length}/{MAX_CHAT_INPUT}
            </span>
          )}
        </p>
      </form>
    </div>
  );
}

function ChatBubble({ message }: { message: ChatMessage }) {
  const user = message.role === "user";
  return (
    <div className={cn("flex flex-col gap-1", user ? "items-end" : "items-start")}>
      {message.parts.map((part, i) => {
        if (part.type === "text") {
          // The user's own words stay plain text; assistant replies are sanitized markdown.
          return user ? (
            <p
              key={i}
              className="max-w-[85%] rounded-2xl bg-foreground px-3 py-2 text-sm whitespace-pre-wrap text-background"
            >
              {part.text}
            </p>
          ) : (
            <div key={i} className="max-w-[85%] rounded-2xl bg-muted px-3 py-2 text-sm">
              <ChatMarkdown text={part.text} />
            </div>
          );
        }
        if (part.type === "dynamic-tool") {
          const [running, done] = TOOL_LABELS[part.toolName] ?? ["Working…", "Done"];
          const finished = part.state === "output-available" || part.state === "output-error";
          return (
            <p key={i} className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {finished ? (
                <Check className="size-3.5" aria-hidden />
              ) : (
                <Sparkles className="size-3.5" aria-hidden />
              )}
              {finished ? done : running}
            </p>
          );
        }
        return null;
      })}
    </div>
  );
}
