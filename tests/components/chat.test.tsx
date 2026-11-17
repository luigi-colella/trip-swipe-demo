import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createUIMessageStreamResponse, type UIMessageChunk } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatDock, ChatDockForRoute } from "@/components/chat/chat-dock";
import ChatPanel from "@/components/chat/chat-panel";
import {
  bindToTrip,
  getChatSession,
  loadHistory,
  onTripUpdate,
  resetChatSessions,
} from "@/components/chat/chat-session";
import type { ChatMessage } from "@/lib/chat";
import { loadChatHistoryAction } from "@/server/actions/chat";
import { TRIP_ID } from "./fixtures";
import { CONNECTION_ERROR } from "@/components/call-server";

/**
 * The chat UI with the real AI SDK client: `fetch` is stubbed with streamed UI message
 * chunks, the history Server Action and the Next.js router are mocked.
 */
vi.mock("@/server/actions/chat", () => ({ loadChatHistoryAction: vi.fn() }));
const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
const params = vi.hoisted(() => ({ value: {} as { id?: string } }));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  useParams: () => params.value,
}));

const OTHER_TRIP = "00000000-0000-4000-8000-0000000000ff";

/** A streamed assistant reply made of the given chunks. */
function reply(...chunks: UIMessageChunk[]) {
  return createUIMessageStreamResponse({
    stream: new ReadableStream({
      start(controller) {
        for (const c of [{ type: "start" }, ...chunks, { type: "finish" }] as UIMessageChunk[]) {
          controller.enqueue(c);
        }
        controller.close();
      },
    }),
  });
}
const text = (value: string): UIMessageChunk[] => [
  { type: "text-start", id: "t" },
  { type: "text-delta", id: "t", delta: value },
  { type: "text-end", id: "t" },
];

const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>();
const sentBodies = () => fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body as string));

/** matchMedia with a controllable desktop width. */
const media = { desktop: false, listeners: new Set<() => void>() };

beforeEach(() => {
  resetChatSessions();
  params.value = {};
  media.desktop = false;
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      media: query,
      get matches() {
        return media.desktop;
      },
      addEventListener: (_: string, fn: () => void) => media.listeners.add(fn),
      removeEventListener: (_: string, fn: () => void) => media.listeners.delete(fn),
    })),
  );
  window.history.replaceState(null, "", "/");
  vi.mocked(loadChatHistoryAction).mockResolvedValue([]);
});
afterEach(() => {
  fetchMock.mockReset();
  router.push.mockReset();
  router.refresh.mockReset();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const history = (role: ChatMessage["role"], value: string, id = value): ChatMessage => ({
  id,
  role,
  parts: [{ type: "text", text: value }],
});

async function send(message: string) {
  const user = userEvent.setup();
  await user.type(screen.getByRole("textbox", { name: "Message" }), message);
  await user.click(screen.getByRole("button", { name: "Send" }));
  return user;
}

describe("chat sessions", () => {
  it("keep one session per trip and move a home chat to the trip it created", () => {
    const home = getChatSession(null);
    expect(getChatSession(null)).toBe(home);
    expect(home.historyLoaded).toBe(true);
    const trip = getChatSession(TRIP_ID);
    expect(trip).not.toBe(home);
    expect(trip.historyLoaded).toBe(false);

    bindToTrip(home, OTHER_TRIP);
    expect(getChatSession(OTHER_TRIP)).toBe(home);
    expect(getChatSession(null)).not.toBe(home);
    bindToTrip(trip, crypto.randomUUID());
    expect(getChatSession(TRIP_ID)).not.toBe(trip);
  });

  it("register one trip-update handler at a time", () => {
    const session = getChatSession(null);
    const first = vi.fn();
    const second = vi.fn();
    const off1 = onTripUpdate(session, first);
    const off2 = onTripUpdate(session, second);
    off1();
    expect(session.onUpdate).toBe(second);
    off2();
    expect(session.onUpdate).toBeUndefined();
  });

  it("load the history once, without overwriting a conversation already started", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const session = getChatSession(TRIP_ID);
    await loadHistory(session, async () => [history("user", "old")]);
    expect(session.chat.messages).toHaveLength(1);
    expect(session.historyLoaded).toBe(true);
    await loadHistory(session, async () => [history("user", "a"), history("user", "b")]);
    expect(session.chat.messages.map((m) => m.id)).toEqual(["old"]);
    const failing = getChatSession(OTHER_TRIP);
    await loadHistory(failing, () => Promise.reject(new Error("offline")));
    expect(failing.historyLoaded).toBe(true);
    expect(console.error).toHaveBeenCalled();
  });
});

describe("ChatPanel", () => {
  it("suggests a first message on the home page and sends the short home history", async () => {
    fetchMock.mockResolvedValueOnce(reply(...text("Where to?")));
    render(<ChatPanel tripId={null} />);
    expect(screen.getByText(/Tell me where you want to go/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Plan a trip to Rome for 3 days" }));
    expect(await screen.findByText("Where to?")).toBeTruthy();

    fetchMock.mockResolvedValueOnce(reply(...text("Done.")));
    await send("Paris instead");
    await screen.findByText("Done.");
    expect(sentBodies()).toEqual([
      { text: "Plan a trip to Rome for 3 days", history: [] },
      {
        text: "Paris instead",
        history: [
          { role: "user", text: "Plan a trip to Rome for 3 days" },
          { role: "assistant", text: "Where to?" },
        ],
      },
    ]);
    expect(loadChatHistoryAction).not.toHaveBeenCalled();
  });

  it("follows a trip created from the home chat and continues the conversation there", async () => {
    window.history.replaceState(null, "", "/");
    fetchMock.mockResolvedValueOnce(
      reply(
        { type: "start-step" },
        { type: "tool-input-start", toolCallId: "c1", toolName: "set_trip", dynamic: true },
        {
          type: "tool-input-available",
          toolCallId: "c1",
          toolName: "set_trip",
          input: { city: "Rome" },
          dynamic: true,
        },
        {
          type: "data-trip-updated",
          transient: true,
          data: { tripId: OTHER_TRIP, view: "swipe" },
        },
        { type: "tool-output-available", toolCallId: "c1", output: "Created." },
        { type: "finish-step" },
        { type: "start-step" },
        ...text("Your trip is ready."),
        { type: "finish-step" },
      ),
    );
    render(<ChatPanel tripId={null} />);
    await send("A trip to Rome");
    expect(await screen.findByText("Your trip is ready.")).toBeTruthy();
    expect(screen.getByText("Trip updated")).toBeTruthy();
    expect(router.push).toHaveBeenCalledWith(`/trip/${OTHER_TRIP}/swipe`);
    expect(getChatSession(OTHER_TRIP).chat.messages).toHaveLength(2);

    fetchMock.mockResolvedValueOnce(reply(...text("Sure.")));
    await send("Thanks");
    await screen.findByText("Sure.");
    expect(sentBodies()[1]).toEqual({ tripId: OTHER_TRIP, text: "Thanks", history: [] });
  });

  it("refreshes the page for updates it already shows and labels running tools", async () => {
    window.history.replaceState(null, "", `/trip/${TRIP_ID}/itinerary`);
    let finish!: () => void;
    fetchMock.mockResolvedValueOnce(
      createUIMessageStreamResponse({
        stream: new ReadableStream<UIMessageChunk>({
          start(controller) {
            controller.enqueue({ type: "start" });
            controller.enqueue({
              type: "tool-input-available",
              toolCallId: "c1",
              toolName: "edit_itinerary",
              input: {},
              dynamic: true,
            });
            controller.enqueue({
              type: "tool-input-available",
              toolCallId: "c2",
              toolName: "future_tool",
              input: {},
              dynamic: true,
            });
            controller.enqueue({
              type: "data-trip-updated",
              transient: true,
              data: { tripId: TRIP_ID, view: "itinerary" },
            });
            controller.enqueue({
              type: "data-trip-updated",
              transient: true,
              data: { tripId: TRIP_ID },
            });
            finish = () => {
              controller.enqueue({ type: "tool-output-error", toolCallId: "c2", errorText: "x" });
              controller.enqueue({ type: "finish" });
              controller.close();
            };
          },
        }),
      }),
    );
    render(<ChatPanel tripId={TRIP_ID} />);
    await waitFor(() => expect(loadChatHistoryAction).toHaveBeenCalledWith(TRIP_ID));
    await send("Move it");
    expect(await screen.findByText("Editing the itinerary…")).toBeTruthy();
    expect(screen.getByText("Working…")).toBeTruthy();
    expect(router.refresh).toHaveBeenCalledTimes(2);
    expect(router.push).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Stop" })).toBeTruthy();
    // Enter while a reply is streaming sends nothing.
    await userEvent.type(screen.getByRole("textbox", { name: "Message" }), "More{Enter}");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    act(() => finish());
    expect(await screen.findByText("Done")).toBeTruthy();
  });

  it("shows the trip's earlier conversation and trip suggestions", async () => {
    let resolve!: (messages: ChatMessage[]) => void;
    vi.mocked(loadChatHistoryAction).mockReturnValueOnce(new Promise((r) => (resolve = r)));
    const { unmount } = render(<ChatPanel tripId={TRIP_ID} />);
    expect(screen.queryByText(/Ask me to add or remove places/)).toBeNull();
    await act(async () => resolve([history("user", "Hi"), history("assistant", "Hello!")]));
    expect(screen.getByText("Hello!")).toBeTruthy();
    unmount();

    vi.mocked(loadChatHistoryAction).mockResolvedValueOnce([]);
    render(<ChatPanel tripId={OTHER_TRIP} />);
    expect(await screen.findByText(/Ask me to add or remove places/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Find more places" })).toBeTruthy();
  });

  it("renders replies as sanitized markdown and the user's words as plain text", async () => {
    vi.mocked(loadChatHistoryAction).mockResolvedValueOnce([
      history("user", "**not bold** <b>me</b>"),
      history(
        "assistant",
        [
          "Day 1 has **three** stops:",
          "",
          "- [Colosseum](https://en.wikipedia.org/wiki/Colosseum)",
          "- [Prize](https://evil.example/win) or [Nothing]()",
          "",
          "<img src=x onerror=alert(1)>![tracker](https://evil.example/pixel.png)",
          "# Heading",
        ].join("\n"),
      ),
    ]);
    render(<ChatPanel tripId={TRIP_ID} />);
    expect(await screen.findByText("**not bold** <b>me</b>")).toBeTruthy();
    expect(screen.getByText("three").tagName).toBe("STRONG");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    const link = screen.getByRole("link", { name: "Colosseum" });
    expect(link.getAttribute("href")).toBe("https://en.wikipedia.org/wiki/Colosseum");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer nofollow");
    // Links elsewhere become plain text; HTML, images and headings are not rendered.
    expect(screen.queryByRole("link", { name: "Prize" })).toBeNull();
    expect(screen.getByText("Prize").tagName).toBe("SPAN");
    expect(screen.getByText("Nothing").tagName).toBe("SPAN");
    expect(document.querySelector("img")).toBeNull();
    expect(screen.queryByRole("heading")).toBeNull();
    expect(screen.getByText("Heading")).toBeTruthy();
  });

  it("ignores a history that arrives after the panel closed", async () => {
    let resolve!: (messages: ChatMessage[]) => void;
    vi.mocked(loadChatHistoryAction).mockReturnValueOnce(new Promise((r) => (resolve = r)));
    const { unmount } = render(<ChatPanel tripId={TRIP_ID} />);
    unmount();
    await act(async () => resolve([history("user", "Hi")]));
    expect(getChatSession(TRIP_ID).chat.messages).toHaveLength(1);
  });

  it("shows errors with a retry, and can stop a reply", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("The assistant is still answering your previous message.", { status: 409 }),
    );
    render(<ChatPanel tripId={null} />);
    const user = await send("Hello");
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("The assistant is still answering your previous message.");

    fetchMock.mockImplementationOnce(
      (_url, init) =>
        new Promise((_, reject) =>
          init.signal!.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          ),
        ),
    );
    await user.click(within(alert).getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Thinking…")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Stop" }));
    await waitFor(() => expect(screen.queryByText("Thinking…")).toBeNull());
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("explains a lost connection instead of showing the browser's error", async () => {
    // Regression: offline, the chat showed the raw "Failed to fetch".
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    render(<ChatPanel tripId={null} />);
    await send("Hello");
    expect((await screen.findByRole("alert")).textContent).toContain(CONNECTION_ERROR);
  });

  it("limits messages to 500 characters and ignores blank ones", async () => {
    render(<ChatPanel tripId={null} />);
    const input = screen.getByRole("textbox", { name: "Message" });
    expect(input.getAttribute("maxlength")).toBe("500");
    const user = userEvent.setup();
    await user.type(input, "   ");
    expect((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(true);
    await user.keyboard("{Enter}");
    await user.clear(input);
    await user.click(input);
    await user.paste("x".repeat(450));
    expect(screen.getByText("450/500")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("ChatDock", () => {
  it("opens the chat in a bottom sheet on mobile", async () => {
    fetchMock.mockResolvedValue(reply(...text("Hi")));
    const user = userEvent.setup();
    render(<ChatDock tripId={null} />);
    // The desktop pane exists (hidden by CSS) but loads nothing on mobile.
    expect(screen.queryByRole("textbox")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Open the trip assistant" }));
    const dialog = screen.getByRole("dialog", { name: "Trip assistant" });
    expect(await within(dialog).findByRole("textbox", { name: "Message" })).toBeTruthy();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Open the trip assistant" }));
    await user.keyboard("a");
    await user.click(screen.getByRole("button", { name: "Close the trip assistant" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Open the trip assistant" }));
    await user.click(screen.getByRole("button", { name: "Close chat" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows a collapsible pane on desktop", async () => {
    media.desktop = true;
    const user = userEvent.setup();
    const { container } = render(<ChatDock tripId={TRIP_ID} />);
    const pane = screen.getByRole("complementary", { name: "Trip assistant" });
    expect(pane.hasAttribute("data-chat-open")).toBe(true);
    expect(await within(pane).findByRole("textbox", { name: "Message" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Hide chat" }));
    expect(container.querySelector("[data-chat-open]")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Open the trip assistant" }));
    expect(await screen.findByRole("textbox", { name: "Message" })).toBeTruthy();
  });

  it("closes the mobile sheet when the window grows to desktop", async () => {
    const user = userEvent.setup();
    render(<ChatDock tripId={null} />);
    await user.click(screen.getByRole("button", { name: "Open the trip assistant" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    media.desktop = true;
    act(() => media.listeners.forEach((fn) => fn()));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("binds the chat to the trip in the URL", async () => {
    media.desktop = true;
    params.value = { id: TRIP_ID };
    const { unmount } = render(<ChatDockForRoute />);
    await waitFor(() => expect(loadChatHistoryAction).toHaveBeenCalledWith(TRIP_ID));
    unmount();
    params.value = { id: "not-a-trip" };
    render(<ChatDockForRoute />);
    expect(await screen.findByText(/Tell me where you want to go/)).toBeTruthy();
  });
});
