import { act, render, screen, waitFor, within } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ItineraryView } from "@/components/itinerary/itinerary-view";
import type { ItineraryData, ItineraryPlace } from "@/lib/itinerary";
import {
  editItineraryAction,
  regenerateItineraryAction,
  undoItineraryAction,
} from "@/server/actions/itinerary";
import { itineraryPlace, TRIP_ID } from "./fixtures";

vi.mock("@/server/actions/itinerary", () => ({
  editItineraryAction: vi.fn(),
  regenerateItineraryAction: vi.fn(),
  undoItineraryAction: vi.fn(),
}));
// The real map needs a layout engine; markers become buttons (see itinerary-map.test.tsx).
vi.mock("react-leaflet", () => ({
  MapContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TileLayer: () => null,
  Polyline: () => null,
  Marker: ({ title, eventHandlers }: { title: string; eventHandlers: { click: () => void } }) => (
    <button data-marker onClick={eventHandlers.click}>
      {title}
    </button>
  ),
  useMap: () => ({
    setView: () => {},
    fitBounds: () => {},
    panTo: () => {},
    getBounds: () => ({ contains: () => true }),
  }),
}));

/** matchMedia with controllable desktop width and reduced-motion preference. */
const media = { desktop: false, reducedMotion: false, listeners: new Set<() => void>() };
function stubMatchMedia() {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      media: query,
      get matches() {
        return query.includes("min-width") ? media.desktop : media.reducedMotion;
      },
      addEventListener: (_: string, fn: () => void) => media.listeners.add(fn),
      removeEventListener: (_: string, fn: () => void) => media.listeners.delete(fn),
    })),
  );
}
function resize(desktop: boolean) {
  media.desktop = desktop;
  act(() => media.listeners.forEach((fn) => fn()));
}

const colosseum = itineraryPlace("Colosseum", 41.8902, 12.4922, { must: true, visitMinutes: 120 });
const forum = itineraryPlace("Roman Forum", 41.8925, 12.4853, { visitMinutes: 90 });
const vatican = itineraryPlace("Vatican Museums", 41.9065, 12.4536, { visitMinutes: 180 });
const trevi = itineraryPlace("Trevi Fountain", 41.9009, 12.4833, { visitMinutes: 20 });
const places: ItineraryPlace[] = [colosseum, forum, vatican, trevi];

const data: ItineraryData = {
  days: [
    {
      title: "Ancient Rome",
      stops: [
        { placeId: colosseum.id, tip: "Book a timed ticket." },
        { placeId: forum.id, tip: null },
        { placeId: vatican.id, tip: null },
      ],
    },
    { title: "Free day", stops: [] },
  ],
  excluded: [
    { placeId: trevi.id, reason: "Didn't fit." },
    { placeId: "00000000-0000-4000-8000-0000000000ff", reason: "Place deleted since." },
  ],
  source: "ai",
};

function renderView(overrides: Partial<Parameters<typeof ItineraryView>[0]> = {}) {
  return render(
    <ItineraryView
      tripId={TRIP_ID}
      pace="relaxed"
      data={data}
      canUndo
      places={places}
      center={{ lat: 41.9, lon: 12.5 }}
      {...overrides}
    />,
  );
}

const timeline = (day = 1) => screen.getByRole("list", { name: `Day ${day} timeline` });
const panel = () => screen.getByRole("tabpanel");

beforeEach(() => {
  media.desktop = false;
  media.reducedMotion = false;
  media.listeners.clear();
  stubMatchMedia();
  Element.prototype.scrollIntoView = vi.fn();
  vi.mocked(editItineraryAction).mockReset().mockResolvedValue({ ok: true });
  vi.mocked(undoItineraryAction).mockReset().mockResolvedValue({ ok: true });
  vi.mocked(regenerateItineraryAction).mockReset();
  for (const kind of ["error", "success", "warning"] as const) {
    vi.spyOn(toast, kind).mockImplementation(() => "");
  }
});
afterEach(() => vi.unstubAllGlobals());

describe("ItineraryView timeline (F4)", () => {
  it("shows one tab per day and the first day's schedule", () => {
    renderView();
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Day 1", "Day 2"]);
    expect(within(panel()).getByRole("heading", { name: "Ancient Rome" })).toBeTruthy();
    const items = within(timeline())
      .getAllByRole("listitem")
      .map((li) => li.textContent);
    expect(items[0]).toContain("09:00 – 11:00");
    expect(items[0]).toContain("Must-see");
    expect(items[0]).toContain("Book a timed ticket.");
    expect(items[1]).toMatch(/^\d+ min walk · \d+ m$/);
    expect(items[2]).toContain("Roman Forum");
    expect(items[3]).toContain("Lunch break");
    expect(items[4]).toMatch(/by public transport · \d+\.\d km$/);
    expect(items[5]).toContain("Vatican Museums");
  });

  it("summarizes the day and warns when it is over the pace", () => {
    renderView();
    // The first match is the day summary, above the timeline.
    expect(
      within(panel())
        .getAllByText(/^09:00 – 1\d:\d\d$/)[0]
        .closest("p"),
    ).not.toBeNull();
    expect(within(panel()).getByText(/of visits and travel/)).toBeTruthy();
    expect(within(panel()).getByText(/Over your relaxed pace by/)).toBeTruthy();
  });

  it("shows empty days and the places left out, with their reason", async () => {
    renderView();
    const excluded = screen.getByRole("region", { name: "Not in the plan (2)" });
    expect(excluded.textContent).toContain("Trevi Fountain— Didn't fit.");
    // Places deleted since the plan was made are skipped.
    expect(within(excluded).getAllByRole("listitem")).toHaveLength(1);
    await userEvent.click(screen.getByRole("tab", { name: "Day 2" }));
    expect(within(panel()).getByText(/Nothing planned for this day yet/)).toBeTruthy();
    expect(within(panel()).queryByRole("link", { name: /Google Maps/ })).toBeNull();
  });

  it("labels AI plans and rule-based plans differently", () => {
    const { unmount } = renderView();
    expect(screen.getByText("AI-generated")).toBeTruthy();
    expect(screen.getByText(/Suggestions and tips are AI-generated/)).toBeTruthy();
    unmount();
    renderView({ data: { ...data, excluded: [], source: "fallback" } });
    expect(screen.getByText("Planned by rules")).toBeTruthy();
    expect(screen.getByText(/couldn't produce a valid plan this time/)).toBeTruthy();
    expect(screen.queryByRole("region", { name: /Not in the plan/ })).toBeNull();
  });
});

describe("ItineraryView Google Maps export (F7)", () => {
  it("links each day to walking directions, split into parts for long days", () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      itineraryPlace(`Stop ${i + 1}`, 41.89 + i / 1000, 12.49, { visitMinutes: 15 }),
    );
    const { unmount } = renderView();
    const link = within(panel()).getByRole("link", { name: "Open in Google Maps" });
    expect(link.getAttribute("href")).toMatch(/travelmode=walking/);
    expect(link.getAttribute("target")).toBe("_blank");
    unmount();
    renderView({
      places: many,
      data: {
        days: [{ title: "Long", stops: many.map((p) => ({ placeId: p.id, tip: null })) }],
        excluded: [],
        source: "ai",
      },
    });
    expect(
      within(panel())
        .getAllByRole("link", { name: /Google Maps, part/ })
        .map((l) => l.textContent),
    ).toEqual(["Google Maps, part 1", "Google Maps, part 2"]);
  });
});

describe("ItineraryView quick actions (F4)", () => {
  async function action(place: string, item: string | RegExp) {
    await userEvent.click(screen.getByRole("button", { name: `Change ${place}` }));
    await userEvent.click(await screen.findByRole("menuitem", { name: item }));
  }
  const names = () =>
    within(timeline())
      .getAllByRole("button", { name: /^Stop \d+:/ })
      .map((b) => b.textContent!.replace(/^Stop \d+: /, ""));

  it("moves stops earlier and later, re-timing the day instantly", async () => {
    renderView();
    await userEvent.click(screen.getByRole("button", { name: "Change Colosseum" }));
    expect(
      (await screen.findByRole("menuitem", { name: "Move earlier" })).getAttribute("aria-disabled"),
    ).toBe("true");
    await userEvent.click(screen.getByRole("menuitem", { name: "Move later" }));
    expect(names()).toEqual(["Roman Forum", "Colosseum", "Vatican Museums"]);
    expect(editItineraryAction).toHaveBeenLastCalledWith(TRIP_ID, {
      type: "move",
      placeId: colosseum.id,
      direction: "down",
    });
    await action("Vatican Museums", "Move earlier");
    expect(editItineraryAction).toHaveBeenLastCalledWith(TRIP_ID, {
      type: "move",
      placeId: vatican.id,
      direction: "up",
    });
  });

  it("moves a stop to another day and confirms where it went", async () => {
    renderView();
    await action("Roman Forum", "Day 2 · Free day");
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Roman Forum moved to Day 2."));
    expect(editItineraryAction).toHaveBeenLastCalledWith(TRIP_ID, {
      type: "change-day",
      placeId: forum.id,
      day: 1,
    });
  });

  it("removes a stop and reports a change the server refused", async () => {
    let resolve!: (r: { ok: false; error: string }) => void;
    vi.mocked(editItineraryAction).mockReturnValue(new Promise((r) => (resolve = r)));
    renderView();
    await action("Colosseum", "Remove from plan");
    expect(names()).toEqual(["Roman Forum", "Vatican Museums"]);
    expect(screen.getByRole("region", { name: "Not in the plan (3)" }).textContent).toContain(
      "Removed by you.",
    );
    // Buttons are disabled while the change is saved.
    expect(screen.getByRole("button", { name: "Undo" }).hasAttribute("disabled")).toBe(true);
    await act(async () => resolve({ ok: false, error: "This change no longer applies." }));
    expect(toast.error).toHaveBeenCalledWith(
      "Couldn't change Colosseum: This change no longer applies.",
    );
    expect(names()).toEqual(["Colosseum", "Roman Forum", "Vatican Museums"]);
  });

  it("hides 'Move to another day' on one-day trips", async () => {
    renderView({ data: { ...data, days: [data.days[0]] } });
    await userEvent.click(screen.getByRole("button", { name: "Change Roman Forum" }));
    await screen.findByRole("menuitem", { name: "Remove from plan" });
    expect(screen.queryByText("Move to another day")).toBeNull();
  });

  it("undoes the last change, reporting failures", async () => {
    vi.mocked(undoItineraryAction)
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false, error: "Nothing to undo." });
    renderView();
    const undo = screen.getByRole("button", { name: "Undo" });
    await userEvent.click(undo);
    await waitFor(() => expect(undo.hasAttribute("disabled")).toBe(false));
    await userEvent.click(undo);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Nothing to undo."));
    expect(undoItineraryAction).toHaveBeenCalledTimes(2);
  });

  it("disables undo for the first version", () => {
    renderView({ canUndo: false });
    expect(screen.getByRole("button", { name: "Undo" }).hasAttribute("disabled")).toBe(true);
  });
});

describe("ItineraryView new plan (F4 regenerate)", () => {
  it("shows progress and confirms a new AI plan", async () => {
    let resolve!: (r: { ok: true; data: { source: "ai" } }) => void;
    vi.mocked(regenerateItineraryAction).mockReturnValue(new Promise((r) => (resolve = r)));
    const { container } = renderView();
    await userEvent.click(screen.getByRole("button", { name: "New plan" }));
    expect(screen.getByText("Planning a new itinerary…")).toBeTruthy();
    expect(container.querySelector(".animate-spin")).not.toBeNull();
    expect(screen.getByRole("button", { name: "New plan" }).hasAttribute("disabled")).toBe(true);
    await act(async () => resolve({ ok: true, data: { source: "ai" } }));
    expect(toast.success).toHaveBeenCalledWith(
      "Here's a new plan. Undo brings the previous one back.",
    );
  });

  it("warns when the new plan was built by rules, and reports errors", async () => {
    vi.mocked(regenerateItineraryAction)
      .mockResolvedValueOnce({ ok: true, data: { source: "fallback" } })
      .mockResolvedValueOnce({ ok: false, error: "Could not plan the trip right now." });
    renderView();
    await userEvent.click(screen.getByRole("button", { name: "New plan" }));
    await waitFor(() =>
      expect(toast.warning).toHaveBeenCalledWith(
        "The AI planner is unavailable, so this plan was built by rules only.",
      ),
    );
    const again = screen.getByRole("button", { name: "New plan" });
    await waitFor(() => expect(again.hasAttribute("disabled")).toBe(false));
    await userEvent.click(again);
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Could not plan the trip right now."),
    );
  });
});

describe("ItineraryView map and list sync (F5)", () => {
  const markers = () => document.querySelectorAll("[data-marker]");

  it("on mobile shows the list first and loads the map only on request", async () => {
    renderView();
    expect(screen.queryByRole("region", { name: "Map of day 1" })).toBeNull();
    expect(screen.getByRole("button", { name: "List" }).getAttribute("aria-pressed")).toBe("true");
    await userEvent.click(screen.getByRole("button", { name: "Map" }));
    expect(screen.getByRole("button", { name: "Map" }).getAttribute("aria-pressed")).toBe("true");
    await waitFor(() => expect(markers()).toHaveLength(3));
    await userEvent.click(screen.getByRole("button", { name: "List" }));
    expect(screen.queryByRole("region", { name: "Map of day 1" })).toBeNull();
  });

  it("on desktop shows the map beside the list, following window resizes", async () => {
    media.desktop = true;
    renderView();
    await waitFor(() => expect(markers()).toHaveLength(3));
    expect(screen.getByRole("region", { name: "Map of day 1" })).toBeTruthy();
    resize(false);
    expect(screen.queryByRole("region", { name: "Map of day 1" })).toBeNull();
  });

  it("selects a stop from the list or from the map, scrolling the list", async () => {
    media.desktop = true;
    renderView();
    await waitFor(() => expect(markers()).toHaveLength(3));
    const forumButton = within(timeline()).getByRole("button", { name: "Stop 2: Roman Forum" });
    await userEvent.click(forumButton);
    expect(forumButton.getAttribute("aria-pressed")).toBe("true");

    await userEvent.click(screen.getByRole("button", { name: "3. Vatican Museums" }));
    expect(
      within(timeline())
        .getByRole("button", { name: "Stop 3: Vatican Museums" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(Element.prototype.scrollIntoView).toHaveBeenLastCalledWith({
      block: "nearest",
      behavior: "smooth",
    });
    media.reducedMotion = true;
    await userEvent.click(screen.getByRole("button", { name: "1. Colosseum" }));
    expect(Element.prototype.scrollIntoView).toHaveBeenLastCalledWith({
      block: "nearest",
      behavior: "auto",
    });

    // Switching day clears the selection.
    await userEvent.click(screen.getByRole("tab", { name: "Day 2" }));
    await userEvent.click(screen.getByRole("tab", { name: "Day 1" }));
    expect(
      within(timeline())
        .queryAllByRole("button", { pressed: true })
        .filter((b) => b.textContent?.startsWith("Stop")),
    ).toHaveLength(0);
  });
});

describe("ItineraryView edge cases", () => {
  it("server-renders the list without the map (no window size on the server)", () => {
    media.desktop = true;
    const html = renderToString(
      <ItineraryView
        tripId={TRIP_ID}
        pace="relaxed"
        data={data}
        canUndo
        places={places}
        center={{ lat: 41.9, lon: 12.5 }}
      />,
    );
    expect(html).toContain("Day 1 timeline");
    expect(html).not.toContain("Map of day 1");
  });

  it("keeps the server's version when a pending change no longer applies to it", async () => {
    let resolve!: (r: { ok: true }) => void;
    vi.mocked(editItineraryAction).mockReturnValue(new Promise((r) => (resolve = r)));
    const props = {
      tripId: TRIP_ID,
      pace: "relaxed" as const,
      canUndo: true,
      places,
      center: { lat: 41.9, lon: 12.5 },
    };
    const { rerender } = render(<ItineraryView {...props} data={data} />);
    await userEvent.click(screen.getByRole("button", { name: "Change Colosseum" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Remove from plan" }));
    // Meanwhile a refresh brings a version without the Colosseum (e.g. from another tab).
    const withoutColosseum = {
      ...data,
      days: [{ ...data.days[0], stops: data.days[0].stops.slice(1) }, data.days[1]],
    };
    rerender(<ItineraryView {...props} data={withoutColosseum} />);
    expect(
      within(timeline())
        .getAllByRole("button", { name: /^Stop/ })
        .map((b) => b.textContent),
    ).toEqual(["Stop 1: Roman Forum", "Stop 2: Vatican Museums"]);
    await act(async () => resolve({ ok: true }));
  });
});
