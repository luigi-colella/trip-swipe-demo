import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "@/components/toast";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Shortlist } from "@/components/review/shortlist";
import type { DeckEntry } from "@/lib/deck";
import { generateItineraryAction } from "@/server/actions/itinerary";
import { updateShortlistAction } from "@/server/actions/trips";
import { placeCard, TRIP_ID } from "./fixtures";

vi.mock("@/server/actions/trips", () => ({ updateShortlistAction: vi.fn() }));
vi.mock("@/server/actions/itinerary", () => ({ generateItineraryAction: vi.fn() }));

const colosseum = placeCard("Colosseum");
const forum = placeCard("Roman Forum");
const entries: DeckEntry[] = [
  { place: colosseum, decision: "must" },
  { place: forum, decision: "like" },
];

beforeEach(() => {
  vi.mocked(updateShortlistAction).mockReset().mockResolvedValue({ ok: true });
  vi.mocked(generateItineraryAction).mockReset();
  vi.spyOn(toast, "error").mockImplementation(() => {});
});

describe("Shortlist (F10)", () => {
  it("lists must-see and liked places with a summary", () => {
    render(<Shortlist tripId={TRIP_ID} entries={entries} />);
    expect(screen.getByText("2 places · 1 must-see")).toBeTruthy();
    const items = screen.getByRole("list", { name: "Shortlist" }).querySelectorAll("li");
    expect(items[0].textContent).toContain("Must-see");
    expect(items[1].textContent).not.toContain("Must-see");
    expect(screen.getByRole("link", { name: "Keep swiping" }).getAttribute("href")).toBe(
      `/trip/${TRIP_ID}/swipe`,
    );
  });

  it("promotes, demotes and removes places, saving each change", async () => {
    render(<Shortlist tripId={TRIP_ID} entries={entries} />);
    await userEvent.click(screen.getByRole("button", { name: "Mark Roman Forum as must-see" }));
    expect(updateShortlistAction).toHaveBeenLastCalledWith(TRIP_ID, forum.id, "must");
    await userEvent.click(screen.getByRole("button", { name: "Unmark Colosseum as must-see" }));
    expect(updateShortlistAction).toHaveBeenLastCalledWith(TRIP_ID, colosseum.id, "like");
    await userEvent.click(screen.getByRole("button", { name: "Remove Colosseum" }));
    expect(updateShortlistAction).toHaveBeenLastCalledWith(TRIP_ID, colosseum.id, "skip");
  });

  it("applies a change instantly and rolls it back with a toast when saving fails", async () => {
    let resolve!: (r: { ok: false; error: string }) => void;
    vi.mocked(updateShortlistAction).mockReturnValue(new Promise((r) => (resolve = r)));
    render(<Shortlist tripId={TRIP_ID} entries={entries} />);
    await userEvent.click(screen.getByRole("button", { name: "Remove Roman Forum" }));
    expect(screen.getByText("1 place · 1 must-see")).toBeTruthy();
    resolve({ ok: false, error: "Trip not found." });
    await waitFor(() => expect(screen.getByText("2 places · 1 must-see")).toBeTruthy());
    expect(toast.error).toHaveBeenCalledWith("Couldn't update Roman Forum. Please try again.");
  });

  it("shows an empty state that leads back to swiping", () => {
    render(<Shortlist tripId={TRIP_ID} entries={[]} />);
    expect(screen.getByRole("heading", { name: "Your shortlist is empty" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to swiping" }).getAttribute("href")).toBe(
      `/trip/${TRIP_ID}/swipe`,
    );
  });

  it("generates the itinerary, showing progress while the AI works", async () => {
    let resolve!: (r: { ok: false; error: string }) => void;
    vi.mocked(generateItineraryAction).mockReturnValue(new Promise((r) => (resolve = r)));
    render(<Shortlist tripId={TRIP_ID} entries={entries} />);
    expect(screen.getByText(/groups nearby places into days/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Generate itinerary" }));
    const button = screen.getByRole("button", { name: "Planning your trip…" });
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(screen.getByText(/can take a couple of minutes/)).toBeTruthy();
    expect(generateItineraryAction).toHaveBeenCalledWith(TRIP_ID);
    resolve({ ok: false, error: "Like at least one place first." });
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Like at least one place first."));
    expect(screen.getByRole("button", { name: "Generate itinerary" })).toBeTruthy();
  });

  it("stays quiet when generation succeeds (the action redirects)", async () => {
    vi.mocked(generateItineraryAction).mockResolvedValue({ ok: true });
    render(<Shortlist tripId={TRIP_ID} entries={entries} />);
    await userEvent.click(screen.getByRole("button", { name: "Generate itinerary" }));
    await waitFor(() => expect(generateItineraryAction).toHaveBeenCalled());
    expect(toast.error).not.toHaveBeenCalled();
  });
});
