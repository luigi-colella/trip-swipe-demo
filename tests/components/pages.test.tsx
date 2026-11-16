import { render, screen, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import RootLayout from "@/app/layout";
import NotFound from "@/app/not-found";
import Home from "@/app/page";
import ItineraryError from "@/app/trip/[id]/itinerary/error";
import ItineraryPage from "@/app/trip/[id]/itinerary/page";
import TripPage from "@/app/trip/[id]/page";
import ReviewError from "@/app/trip/[id]/review/error";
import ReviewPage from "@/app/trip/[id]/review/page";
import SwipeError from "@/app/trip/[id]/swipe/error";
import SwipePage from "@/app/trip/[id]/swipe/page";
import { db, sqlite } from "@/server/db/client";
import { places } from "@/server/db/schema";
import { saveItinerary } from "@/server/itinerary/itineraries";
import { upsertCity } from "@/server/places/cities";
import { createTrip, recordSwipe, setTripStatus, type Trip } from "@/server/trips/trips";
import { resetDatabase } from "../helpers/db";
import { resolveServerTree } from "../helpers/server-components";

/** App Router pages rendered from a throwaway database, with Next.js navigation stubbed. */
const t = vi.hoisted(() => ({ cleanup: () => {} }));
vi.mock("@/server/db/client", async () => {
  const { createTestDatabase } = await import("../helpers/db");
  const created = createTestDatabase();
  t.cleanup = created.cleanup;
  return { db: created.db, sqlite: created.sqlite, connection: created };
});
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: async () => {},
}));
vi.mock("next/font/google", () => ({
  Geist: () => ({ variable: "font-geist-sans" }),
  Geist_Mono: () => ({ variable: "font-geist-mono" }),
}));

let trip: Trip;
let placeIds: string[];

beforeEach(() => {
  resetDatabase(sqlite);
  const rome = upsertCity(db, {
    osmRef: "R41485",
    name: "Rome",
    state: "Lazio",
    country: "Italy",
    countryCode: "IT",
    lat: 41.8933,
    lon: 12.4829,
  });
  placeIds = (
    [
      ["Colosseum", 41.8902, 12.4922],
      ["Pantheon", 41.8986, 12.4769],
    ] as const
  ).map(
    ([name, lat, lon]) =>
      db
        .insert(places)
        .values({
          id: crypto.randomUUID(),
          cityId: rome.id,
          wikiTitle: name,
          wikiUrl: `https://en.wikipedia.org/wiki/${name}`,
          name,
          category: "landmark",
          pitch: `${name} pitch.`,
          lat,
          lon,
          visitMinutes: 60,
          popularity: 100,
        })
        .returning()
        .get().id,
  );
  trip = createTrip(db, { cityId: rome.id, days: 2, pace: "relaxed", interests: ["art"] });
});
afterAll(() => t.cleanup());

const pageProps = (id: string) => ({
  params: Promise.resolve({ id }),
  searchParams: Promise.resolve({}),
});
const page = async (Page: (props: ReturnType<typeof pageProps>) => React.ReactNode, id = trip.id) =>
  render(await resolveServerTree(Page(pageProps(id))));

describe("static pages", () => {
  it("renders the setup page", () => {
    render(<Home />);
    expect(screen.getByRole("heading", { level: 1, name: "Plan a city trip" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Start swiping" })).toBeTruthy();
  });

  it("renders the not-found page with a way back", () => {
    render(<NotFound />);
    expect(screen.getByRole("heading", { name: "Page not found" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Plan a new trip" }).getAttribute("href")).toBe("/");
  });

  it("wraps every page in the app shell, widening it for [data-wide] pages", () => {
    const html = renderToStaticMarkup(
      <RootLayout params={Promise.resolve({})}>
        <p>Child page</p>
      </RootLayout>,
    );
    expect(html).toMatch(/^<html lang="en" class="font-geist-sans font-geist-mono h-full/);
    expect(html).toContain("TravelSwipe AI</a>");
    expect(html).toContain("<p>Child page</p>");
    expect(html).toContain("has-data-wide:max-w-6xl");
    expect(html).toContain("group-has-data-wide/body:max-w-6xl");
  });
});

describe("error boundaries", () => {
  it.each([
    [SwipeError, "We couldn't load the places"],
    [ReviewError, "We couldn't load your shortlist"],
    [ItineraryError, "We couldn't load your itinerary"],
  ])("%o explains the failure and offers a retry", (Boundary, title) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const retry = vi.fn();
    render(<Boundary error={new Error("boom")} retry={retry} />);
    expect(screen.getByRole("heading", { name: title })).toBeTruthy();
    screen.getByRole("button", { name: "Try again" }).click();
    expect(retry).toHaveBeenCalled();
  });
});

describe("/trip/[id]", () => {
  it.each([
    ["swiping", "swipe"],
    ["review", "review"],
    ["itinerary", "itinerary"],
  ] as const)("opens a %s trip on its %s step", async (status, step) => {
    setTripStatus(db, trip.id, status);
    await expect(page(TripPage)).rejects.toThrow(`REDIRECT /trip/${trip.id}/${step}`);
  });

  it("renders not-found for unknown trips", async () => {
    await expect(page(TripPage, "00000000-0000-4000-8000-000000000000")).rejects.toThrow(
      "NOT_FOUND",
    );
  });
});

describe("/trip/[id]/swipe", () => {
  it("shows the trip header and the deck from the city pool", async () => {
    recordSwipe(db, trip, placeIds[0], "like");
    await page(SwipePage);
    expect(screen.getByRole("heading", { level: 1, name: "Rome" })).toBeTruthy();
    expect(screen.getByText("2 days · Relaxed")).toBeTruthy();
    const stack = screen.getByRole("group", { name: "Places to swipe" });
    expect(within(stack).getByRole("heading", { name: "Pantheon" })).toBeTruthy();
    expect(screen.getByText("1 in shortlist")).toBeTruthy();
  });
});

describe("/trip/[id]/review", () => {
  it("lists the shortlist under the trip header", async () => {
    recordSwipe(db, trip, placeIds[1], "must");
    setTripStatus(db, trip.id, "review");
    await page(ReviewPage);
    expect(screen.getByRole("navigation", { name: "Trip progress" })).toBeTruthy();
    const list = screen.getByRole("list", { name: "Shortlist" });
    expect(list.textContent).toContain("Pantheon");
    expect(list.textContent).toContain("Must-see");
  });
});

describe("/trip/[id]/itinerary", () => {
  it("sends trips without an itinerary back to the review", async () => {
    await expect(page(ItineraryPage)).rejects.toThrow(`REDIRECT /trip/${trip.id}/review`);
  });

  it("shows the latest version with undo available after a change", async () => {
    const stops = placeIds.map((placeId) => ({ placeId, tip: null }));
    saveItinerary(db, trip.id, { days: [{ title: "First", stops }], excluded: [], source: "ai" });
    saveItinerary(db, trip.id, {
      days: [
        { title: "Ancient Rome", stops },
        { title: "Free day", stops: [] },
      ],
      excluded: [],
      source: "fallback",
    });
    setTripStatus(db, trip.id, "itinerary");
    const { container } = await page(ItineraryPage);
    expect(container.querySelector("[data-wide]")).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Ancient Rome" })).toBeTruthy();
    expect(screen.getByText("Planned by rules")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Undo" }).hasAttribute("disabled")).toBe(false);
    expect(
      within(screen.getByRole("list", { name: "Day 1 timeline" })).getAllByRole("button", {
        name: /^Stop/,
      }),
    ).toHaveLength(2);
  });
});
