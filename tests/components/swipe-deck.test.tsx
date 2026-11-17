import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "@/components/toast";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SwipeDeck } from "@/components/swipe/swipe-deck";
import type { DeckEntry } from "@/lib/deck";
import type { PlaceCard } from "@/lib/places";
import {
  loadMorePlacesAction,
  recordSwipeAction,
  startReviewAction,
  undoSwipeAction,
} from "@/server/actions/trips";
import { placeCard, TRIP_ID } from "./fixtures";

vi.mock("@/server/actions/trips", () => ({
  recordSwipeAction: vi.fn(),
  undoSwipeAction: vi.fn(),
  loadMorePlacesAction: vi.fn(),
  startReviewAction: vi.fn(),
}));

let reducedMotion: boolean;

beforeEach(() => {
  reducedMotion = true;
  vi.stubGlobal(
    "matchMedia",
    vi.fn((media: string) => ({ matches: reducedMotion, media })),
  );
  HTMLElement.prototype.setPointerCapture = vi.fn();
  vi.mocked(recordSwipeAction).mockReset().mockResolvedValue({ ok: true });
  vi.mocked(undoSwipeAction).mockReset().mockResolvedValue({ ok: true });
  vi.mocked(loadMorePlacesAction).mockReset();
  vi.mocked(startReviewAction).mockReset();
  for (const kind of ["error", "info"] as const) {
    vi.spyOn(toast, kind).mockImplementation(() => {});
  }
});
afterEach(() => vi.unstubAllGlobals());

function deck(n: number, extra: (i: number) => Partial<PlaceCard> = () => ({})) {
  return Array.from({ length: n }, (_, i) => placeCard(`Place ${i + 1}`, extra(i)));
}

function renderDeck(cards: PlaceCard[], history: DeckEntry[] = []) {
  return render(
    <SwipeDeck tripId={TRIP_ID} interests={[]} initialDeck={cards} initialHistory={history} />,
  );
}

const stack = () => document.querySelector('[aria-roledescription="card stack"]')!;
const topCard = () => stack().querySelector<HTMLElement>(":scope > div:not([aria-hidden])")!;
const topName = () => topCard().querySelector("h2")!.textContent;
/** "Place 2 of 5" / "All 5 places seen": the counter right above the stack. */
const progress = () => stack().previousElementSibling!.firstElementChild!.textContent;
const stamp = (label: string) =>
  [...topCard().querySelectorAll<HTMLElement>("span[aria-hidden]")].find(
    (s) => s.textContent === label,
  )!;

describe("SwipeDeck buttons and keyboard (F3)", () => {
  it("shows the top three cards and the progress", () => {
    renderDeck(deck(5));
    expect(stack().children).toHaveLength(3);
    expect(progress()).toBe("Place 1 of 5");
    expect(screen.getByText("0 in shortlist")).toBeTruthy();
    expect(topName()).toBe("Place 1");
    expect(screen.getByRole("button", { name: /Review shortlist/ }).hasAttribute("disabled")).toBe(
      true,
    );
    expect(screen.getByRole("button", { name: "Undo" }).hasAttribute("disabled")).toBe(true);
  });

  it("likes, skips and marks must-see with the buttons, saving each choice", async () => {
    renderDeck(deck(4));
    await userEvent.click(screen.getByRole("button", { name: "Like" }));
    await userEvent.click(screen.getByRole("button", { name: "Skip" }));
    await userEvent.click(screen.getByRole("button", { name: "Must-see" }));
    expect(vi.mocked(recordSwipeAction).mock.calls.map((c) => c[2])).toEqual([
      "like",
      "skip",
      "must",
    ]);
    expect(progress()).toBe("Place 4 of 4");
    expect(screen.getByText("2 in shortlist")).toBeTruthy();
    expect(screen.getByText("Must-see: Place 3")).toBeTruthy();
  });

  it("uses the arrow keys, Backspace and Z, but not while typing or with modifiers", async () => {
    renderDeck(deck(4));
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(progress()).toBe("Place 2 of 4");
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    fireEvent.keyDown(window, { key: "ArrowUp" });
    expect(progress()).toBe("Place 4 of 4");
    fireEvent.keyDown(window, { key: "Backspace" });
    expect(progress()).toBe("Place 3 of 4");
    fireEvent.keyDown(window, { key: "Z" });
    expect(progress()).toBe("Place 2 of 4");
    expect(undoSwipeAction).toHaveBeenCalledTimes(2);

    fireEvent.keyDown(window, { key: "ArrowRight", ctrlKey: true });
    fireEvent.keyDown(window, { key: "ArrowRight", altKey: true });
    fireEvent.keyDown(window, { key: "ArrowRight", metaKey: true });
    const field = document.body.appendChild(document.createElement("input"));
    fireEvent.keyDown(field, { key: "ArrowRight" });
    field.remove();
    const handled = new KeyboardEvent("keydown", { key: "ArrowRight", cancelable: true });
    handled.preventDefault();
    act(() => void window.dispatchEvent(handled));
    fireEvent.keyDown(document.body, { key: "Enter" });
    expect(progress()).toBe("Place 2 of 4");
  });

  it("undoes the last swipe and ignores undo with nothing to undo", async () => {
    renderDeck(deck(2));
    fireEvent.keyDown(window, { key: "Backspace" });
    expect(undoSwipeAction).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Like" }));
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(topName()).toBe("Place 1");
    expect(screen.getByText("Undone: Place 1")).toBeTruthy();
  });

  it("undoes the swipe just made even before the deck re-renders (fast keys)", () => {
    // Regression: undo used the last rendered history, so a quick swipe + undo sent the undo of
    // the previous place to the server while the deck kept it: the two went out of sync.
    const [previous, ...cards] = deck(3);
    renderDeck(cards, [{ place: previous, decision: "like" }]);
    act(() => {
      fireEvent.keyDown(window, { key: "ArrowRight" });
      fireEvent.keyDown(window, { key: "Backspace" });
    });
    expect(recordSwipeAction).toHaveBeenCalledWith(TRIP_ID, cards[0].id, "like");
    expect(vi.mocked(undoSwipeAction).mock.calls).toEqual([[TRIP_ID, cards[0].id]]);
    expect(topName()).toBe("Place 2");
    expect(progress()).toBe("Place 2 of 3");
  });

  it("rolls back a swipe and an undo that the server rejects", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(recordSwipeAction).mockResolvedValueOnce({ ok: false, error: "Trip not found." });
    renderDeck(deck(2));
    await userEvent.click(screen.getByRole("button", { name: "Like" }));
    await waitFor(() => expect(topName()).toBe("Place 1"));
    expect(toast.error).toHaveBeenCalledWith(
      "Couldn't save your choice for Place 1. Please try again.",
    );

    await userEvent.click(screen.getByRole("button", { name: "Like" }));
    vi.mocked(undoSwipeAction).mockRejectedValueOnce(new Error("offline"));
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(topName()).toBe("Place 2"));
    expect(toast.error).toHaveBeenCalledWith("Couldn't undo, please try again.");

    vi.mocked(undoSwipeAction).mockResolvedValueOnce({ ok: false, error: "Trip not found." });
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(3));
    expect(topName()).toBe("Place 2");
    expect(log).toHaveBeenCalledTimes(3);
  });

  it("preloads the photos of the next cards", () => {
    const created: string[] = [];
    vi.stubGlobal(
      "Image",
      class {
        set src(value: string) {
          created.push(value);
        }
      },
    );
    renderDeck(deck(6, (i) => ({ imageUrl: i === 4 ? null : `https://img/${i + 1}.jpg` })));
    // Cards 4 and 5 come after the three in the DOM; card 5 has no photo.
    expect(created).toEqual(["https://img/4.jpg"]);
  });

  it("waits for the page to load before preloading, so the top photo loads first", () => {
    const created: string[] = [];
    vi.stubGlobal(
      "Image",
      class {
        set src(value: string) {
          created.push(value);
        }
      },
    );
    const readyState = vi.spyOn(document, "readyState", "get").mockReturnValue("loading");
    try {
      renderDeck(deck(4, (i) => ({ imageUrl: `https://img/${i + 1}.jpg` })));
      expect(created).toEqual([]);
      window.dispatchEvent(new Event("load"));
      expect(created).toEqual(["https://img/4.jpg"]);
    } finally {
      readyState.mockRestore();
    }
  });

  it("gives the top card's photo a high fetch priority and the cards behind it a low one", () => {
    renderDeck(deck(3, (i) => ({ imageUrl: `https://img/${i + 1}.jpg` })));
    const priorities = Array.from(document.querySelectorAll("img"), (img) => [
      img.getAttribute("src"),
      img.getAttribute("fetchpriority"),
    ]);
    expect(priorities).toEqual(
      expect.arrayContaining([
        ["https://img/1.jpg", "high"],
        ["https://img/2.jpg", "low"],
        ["https://img/3.jpg", "low"],
      ]),
    );
  });
});

describe("SwipeDeck end of the deck", () => {
  it("offers Load more and appends the new places", async () => {
    vi.mocked(loadMorePlacesAction).mockResolvedValue({ ok: true, data: deck(1) });
    renderDeck([], [{ place: placeCard("Seen"), decision: "like" }]);
    expect(progress()).toBe("All 1 places seen");
    expect(screen.getByRole("heading", { name: "You've seen every place" })).toBeTruthy();
    // Swipe keys do nothing without cards.
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(recordSwipeAction).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Load more" }));
    await waitFor(() => expect(progress()).toBe("Place 2 of 2"));
  });

  it("explains when Load more finds nothing or fails", async () => {
    let resolve!: (r: { ok: false; error: string }) => void;
    vi.mocked(loadMorePlacesAction)
      .mockResolvedValueOnce({ ok: true, data: [] })
      .mockReturnValueOnce(new Promise((r) => (resolve = r)));
    renderDeck([]);
    await userEvent.click(screen.getByRole("button", { name: "Load more" }));
    await waitFor(() =>
      expect(toast.info).toHaveBeenCalledWith("No new places found for this city."),
    );
    await userEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(screen.getByRole("button", { name: "Finding more places…" })).toBeTruthy();
    await act(async () => resolve({ ok: false, error: "Try later." }));
    expect(toast.error).toHaveBeenCalledWith("Try later.");
  });

  it("opens the review, reporting refusals", async () => {
    let resolve!: (r: { ok: false; error: string }) => void;
    vi.mocked(startReviewAction).mockReturnValue(new Promise((r) => (resolve = r)));
    renderDeck(deck(1), [{ place: placeCard("Liked"), decision: "must" }]);
    const review = screen.getByRole("button", { name: "Review shortlist (1)" });
    await userEvent.click(review);
    expect(review.hasAttribute("disabled")).toBe(true);
    await act(async () => resolve({ ok: false, error: "Like at least one place first." }));
    expect(toast.error).toHaveBeenCalledWith("Like at least one place first.");
  });

  it("stays quiet when the review opens (the action redirects)", async () => {
    vi.mocked(startReviewAction).mockResolvedValue({ ok: true });
    renderDeck(deck(1), [{ place: placeCard("Liked"), decision: "like" }]);
    await userEvent.click(screen.getByRole("button", { name: "Review shortlist (1)" }));
    await waitFor(() => expect(startReviewAction).toHaveBeenCalledWith(TRIP_ID));
    expect(toast.error).not.toHaveBeenCalled();
  });
});

describe("SwipeDeck gestures", () => {
  let now = 0;
  beforeEach(() => {
    now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
  });

  function drag(
    dx: number,
    dy: number,
    ms = 1000,
    end: "pointerUp" | "pointerCancel" = "pointerUp",
  ) {
    const card = topCard();
    fireEvent.pointerDown(card, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
    now += ms;
    fireEvent.pointerMove(card, { pointerId: 1, clientX: 100 + dx, clientY: 100 + dy });
    fireEvent[end](card, { pointerId: 1, clientX: 100 + dx, clientY: 100 + dy });
    return card;
  }

  it("commits a swipe by distance in each direction", () => {
    renderDeck(deck(4));
    drag(150, 0);
    drag(-150, 10);
    drag(20, -150);
    expect(vi.mocked(recordSwipeAction).mock.calls.map((c) => c[2])).toEqual([
      "like",
      "skip",
      "must",
    ]);
  });

  it("commits a quick fling over a short distance", () => {
    renderDeck(deck(3));
    drag(40, 0, 50);
    drag(-40, 0, 50);
    expect(vi.mocked(recordSwipeAction).mock.calls.map((c) => c[2])).toEqual(["like", "skip"]);
  });

  it("snaps back after a short or cancelled drag and fades the stamps out", () => {
    renderDeck(deck(2));
    const card = topCard();
    fireEvent.pointerDown(card, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(card, { pointerId: 1, clientX: 150, clientY: 100 });
    expect(card.style.transform).toBe("translate(50px, 0px) rotate(2.5deg)");
    expect(stamp("Like").style.opacity).toBe("0.5");
    expect(stamp("Skip").style.opacity).toBe("0");
    fireEvent.pointerMove(card, { pointerId: 1, clientX: 100, clientY: 20 });
    expect(stamp("Must-see").style.opacity).toBe("0.8");
    expect(stamp("Like").style.opacity).toBe("0");
    fireEvent.pointerUp(card, { pointerId: 1 });
    expect(card.style.transform).toBe("");
    expect(stamp("Must-see").style.opacity).toBe("0");

    drag(150, 0, 1000, "pointerCancel");
    expect(recordSwipeAction).not.toHaveBeenCalled();
    expect(topName()).toBe("Place 1");
  });

  it("ignores secondary buttons, links, cards below the top one and stray moves", () => {
    renderDeck(deck(3));
    const card = topCard();
    fireEvent.pointerMove(card, { pointerId: 1, clientX: 300 });
    fireEvent.pointerUp(card, { pointerId: 1, clientX: 300 });
    fireEvent.pointerDown(card, { button: 2, pointerId: 1, clientX: 0 });
    fireEvent.pointerUp(card, { pointerId: 1, clientX: 300 });
    const link = card.querySelector("a")!;
    fireEvent.pointerDown(link, { button: 0, pointerId: 1, clientX: 0 });
    fireEvent.pointerUp(card, { pointerId: 1, clientX: 300 });
    const below = stack().querySelector<HTMLElement>(":scope > div[aria-hidden]")!;
    fireEvent.pointerDown(below, { button: 0, pointerId: 1, clientX: 0 });
    fireEvent.pointerUp(below, { pointerId: 1, clientX: 300 });
    expect(recordSwipeAction).not.toHaveBeenCalled();
    expect(card.style.transform).toBe("");
  });

  it("animates the card out before committing, unless motion is reduced", async () => {
    reducedMotion = false;
    renderDeck(deck(4));
    const card = drag(150, 30);
    expect(card.style.transform).toMatch(/^translate\(\d+px, 30px\)/);
    // Further input on a leaving card is ignored.
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(recordSwipeAction).not.toHaveBeenCalled();
    await waitFor(() => expect(recordSwipeAction).toHaveBeenCalledTimes(1));

    await userEvent.click(screen.getByRole("button", { name: "Must-see" }));
    expect(topCard().style.transform).toBe(`translate(0px, -${window.innerHeight}px) rotate(0deg)`);
    await waitFor(() => expect(recordSwipeAction).toHaveBeenCalledTimes(2));
    await userEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(topCard().style.transform).toMatch(/^translate\(-\d+px, 0px\)/);
    await waitFor(() => expect(recordSwipeAction).toHaveBeenCalledTimes(3));
    expect(vi.mocked(recordSwipeAction).mock.calls.map((c) => c[2])).toEqual([
      "like",
      "must",
      "skip",
    ]);
  });
});
