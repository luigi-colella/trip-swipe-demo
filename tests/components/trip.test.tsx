import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ErrorState } from "@/components/trip/error-state";
import { DeckSkeleton, ListSkeleton, TripHeaderSkeleton } from "@/components/trip/skeletons";
import { TripHeader } from "@/components/trip/trip-header";

const tripId = "00000000-0000-4000-8000-000000000001";

describe("TripHeader", () => {
  const header = (
    current: "swipe" | "review" | "itinerary",
    status: "swiping" | "review" | "itinerary",
  ) =>
    render(
      <TripHeader
        tripId={tripId}
        city="Rome"
        days={1}
        pace="relaxed"
        status={status}
        current={current}
      />,
    );

  it("summarizes the trip", () => {
    header("swipe", "swiping");
    expect(screen.getByRole("heading", { level: 1, name: "Rome" })).toBeTruthy();
    expect(screen.getByText("1 day · Relaxed")).toBeTruthy();
  });

  it("links only to the steps the trip has reached", () => {
    header("swipe", "swiping");
    const nav = screen.getByRole("navigation", { name: "Trip progress" });
    expect(nav.querySelector('[aria-current="step"]')?.textContent).toContain("Swipe");
    expect(screen.queryByRole("link", { name: /Review/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /Itinerary/ })).toBeNull();
  });

  it("links back to swipe and forward to the itinerary once planned", () => {
    header("review", "itinerary");
    expect(screen.getByRole("link", { name: /Swipe/ }).getAttribute("href")).toBe(
      `/trip/${tripId}/swipe`,
    );
    expect(screen.getByRole("link", { name: /Itinerary/ }).getAttribute("href")).toBe(
      `/trip/${tripId}/itinerary`,
    );
    // The current step is not a link.
    expect(screen.queryByRole("link", { name: /Review/ })).toBeNull();
  });

  it("marks earlier steps as done on the itinerary", () => {
    const { container } = render(
      <TripHeader
        tripId={tripId}
        city="Paris"
        days={3}
        pace="intense"
        status="itinerary"
        current="itinerary"
      />,
    );
    expect(screen.getByText("3 days · Intense")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Review/ })).toBeTruthy();
    // Setup, Swipe and Review show a check mark instead of their number.
    expect(container.querySelectorAll("svg.lucide-check")).toHaveLength(3);
  });
});

describe("ErrorState", () => {
  it("logs the error, offers a retry and a way out", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const retry = vi.fn();
    const error = new Error("boom");
    render(<ErrorState error={error} retry={retry} title="Oops" message="Try later." />);
    expect(screen.getByRole("alert").textContent).toContain("Try later.");
    expect(log).toHaveBeenCalledWith(error);
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("link", { name: "New trip" }).getAttribute("href")).toBe("/");
  });
});

describe("skeletons", () => {
  it("keep the layout while content loads", () => {
    render(
      <>
        <TripHeaderSkeleton />
        <DeckSkeleton />
        <DeckSkeleton message="Finding the best of Rome…" />
        <ListSkeleton />
      </>,
    );
    expect(screen.getByText("Loading places…")).toBeTruthy();
    expect(screen.getByText("Finding the best of Rome…")).toBeTruthy();
    expect(screen.getByRole("status", { name: "Loading" }).children).toHaveLength(4);
  });
});
