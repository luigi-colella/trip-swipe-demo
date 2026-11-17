import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CityCombobox,
  cityLabel,
  type CityOption,
  type CitySelection,
} from "@/components/setup/city-combobox";
import { TripSetupForm } from "@/components/setup/trip-setup-form";
import { createTripAction } from "@/server/actions/trips";
import { CONNECTION_ERROR } from "@/components/call-server";

vi.mock("@/server/actions/trips", () => ({ createTripAction: vi.fn() }));

const ROME: CityOption = { osmRef: "R41485", name: "Rome", state: "Lazio", country: "Italy" };
const ROME_GA: CityOption = {
  osmRef: "R119557",
  name: "Rome",
  state: "Georgia",
  country: "United States",
};
const MONACO: CityOption = { osmRef: "R1124039", name: "Monaco", state: null, country: "Monaco" };

type Reply = { status?: number; cities?: CityOption[]; delay?: number };
let replies: Record<string, Reply>;
const requested: string[] = [];

/** Fake /api/cities that honours AbortSignal like the real fetch. */
function fakeFetch(input: string | URL | Request, init?: RequestInit) {
  const q = new URL(String(input), "http://localhost").searchParams.get("q")!;
  requested.push(q);
  const reply = replies[q] ?? { cities: [] };
  return new Promise<Response>((resolve, reject) => {
    const timer = setTimeout(
      () =>
        resolve(
          new Response(JSON.stringify({ cities: reply.cities ?? [] }), {
            status: reply.status ?? 200,
          }),
        ),
      reply.delay ?? 0,
    );
    init?.signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    });
  });
}

beforeEach(() => {
  replies = { ro: { cities: [ROME, ROME_GA] } };
  requested.length = 0;
  vi.stubGlobal("fetch", vi.fn(fakeFetch));
  vi.mocked(createTripAction).mockReset();
});
afterEach(() => vi.unstubAllGlobals());

function Harness({ initial = null }: { initial?: CitySelection | null }) {
  const [value, setValue] = useState<CitySelection | null>(initial);
  return (
    <>
      <label htmlFor="city">City</label>
      <CityCombobox id="city" value={value} onChange={setValue} />
      <output>{value ? `${value.query} -> ${value.city.osmRef}` : "none"}</output>
    </>
  );
}

const input = () => screen.getByRole("combobox", { name: "City" });
const options = () => screen.queryAllByRole("option");
const selection = () => screen.getByRole("status").textContent;

describe("CityCombobox (F1)", () => {
  it("labels cities with their region when known", () => {
    expect(cityLabel(ROME)).toBe("Rome, Lazio, Italy");
    expect(cityLabel(MONACO)).toBe("Monaco, Monaco");
  });

  it("searches after two characters and picks a suggestion with the mouse", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(input(), "r");
    expect(input().getAttribute("aria-expanded")).toBe("false");
    await user.type(input(), "o");
    await waitFor(() => expect(options()).toHaveLength(2));
    expect(requested).toEqual(["ro"]);
    expect(input().getAttribute("aria-expanded")).toBe("true");
    expect(options()[0].getAttribute("aria-selected")).toBe("true");
    await user.hover(options()[1]);
    expect(options()[1].getAttribute("aria-selected")).toBe("true");
    await user.click(screen.getByRole("option", { name: /Georgia/ }));
    expect(selection()).toBe("ro -> R119557");
    expect((input() as HTMLInputElement).value).toBe("Rome, Georgia, United States");
    expect(input().getAttribute("aria-expanded")).toBe("false");
  });

  it("moves through suggestions with the keyboard, wrapping around, and picks with Enter", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(input(), "ro");
    await waitFor(() => expect(options()).toHaveLength(2));
    await user.keyboard("{Escape}");
    expect(input().getAttribute("aria-expanded")).toBe("false");
    // Enter does nothing while the list is closed; arrows reopen it.
    await user.keyboard("{Enter}");
    expect(selection()).toBe("none");
    await user.keyboard("{ArrowDown}");
    expect(input().getAttribute("aria-expanded")).toBe("true");
    expect(input().getAttribute("aria-activedescendant")).toBe(options()[1].id);
    await user.keyboard("{ArrowDown}");
    expect(options()[0].getAttribute("aria-selected")).toBe("true");
    await user.keyboard("{ArrowUp}");
    expect(options()[1].getAttribute("aria-selected")).toBe("true");
    await user.keyboard("{Enter}");
    expect(selection()).toBe("ro -> R119557");
  });

  it("clears the selection as soon as the text changes", async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ query: "ro", city: ROME }} />);
    expect((input() as HTMLInputElement).value).toBe("Rome, Lazio, Italy");
    await user.type(input(), "x");
    expect(selection()).toBe("none");
  });

  it("says when nothing matches and when the search is down", async () => {
    const user = userEvent.setup();
    replies.zz = { cities: [] };
    replies.zzz = { status: 500 };
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<Harness />);
    await user.type(input(), "zz");
    await screen.findByText("No cities found.");
    expect(input().getAttribute("aria-activedescendant")).toBeNull();
    // Arrow keys with no suggestions do nothing.
    await user.keyboard("{ArrowDown}");
    expect(options()).toHaveLength(0);
    await user.type(input(), "z");
    await screen.findByText("City search is unavailable, please retry.");
    expect(log).toHaveBeenCalled();
  });

  it("shows a spinner while searching and drops answers to outdated queries", async () => {
    const user = userEvent.setup();
    replies.ro = { cities: [ROME_GA], delay: 400 };
    replies.rom = { cities: [ROME] };
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { container } = render(<Harness />);
    await user.type(input(), "ro");
    await waitFor(() => expect(container.querySelector(".animate-spin")).not.toBeNull());
    await user.type(input(), "m");
    await waitFor(() => expect(options()).toHaveLength(1));
    expect(options()[0].textContent).toContain("Lazio");
    expect(requested).toEqual(["ro", "rom"]);
    // The aborted request is not reported as an error.
    expect(log).not.toHaveBeenCalled();
  });

  it("closes the list shortly after losing focus and reopens it on focus", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(input(), "ro");
    await waitFor(() => expect(options()).toHaveLength(2));
    act(() => input().blur());
    expect(input().getAttribute("aria-expanded")).toBe("true");
    await waitFor(() => expect(input().getAttribute("aria-expanded")).toBe("false"));
    act(() => input().focus());
    expect(input().getAttribute("aria-expanded")).toBe("true");
  });
});

describe("TripSetupForm (F1)", () => {
  it("offers 1 to 7 days, three paces and optional interests with sensible defaults", () => {
    render(<TripSetupForm />);
    expect(screen.getAllByRole("radio", { name: /^[1-7]$/ })).toHaveLength(7);
    expect((screen.getByRole("radio", { name: "3" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("radio", { name: /Balanced/ }) as HTMLInputElement).checked).toBe(
      true,
    );
    expect(screen.getByText("6 h/day")).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Local life" })).toBeTruthy();
  });

  it("asks for a city from the suggestions before submitting", async () => {
    render(<TripSetupForm />);
    await userEvent.click(screen.getByRole("button", { name: "Start swiping" }));
    expect(screen.getByRole("alert").textContent).toBe("Pick a city from the suggestions.");
    expect(input().getAttribute("aria-invalid")).toBe("true");
    expect(createTripAction).not.toHaveBeenCalled();
  });

  it("submits the chosen city and options, then shows the server's error", async () => {
    let resolve!: (state: { error: string }) => void;
    vi.mocked(createTripAction).mockReturnValue(new Promise((r) => (resolve = r)));
    const user = userEvent.setup();
    render(<TripSetupForm />);
    await user.type(input(), "ro");
    await waitFor(() => expect(options()).toHaveLength(2));
    await user.click(options()[0]);
    await user.click(screen.getByRole("radio", { name: "2" }));
    await user.click(screen.getByRole("checkbox", { name: "Art" }));
    await user.click(screen.getByRole("button", { name: "Start swiping" }));

    await screen.findByRole("button", { name: "Creating your trip…" });
    const data = vi.mocked(createTripAction).mock.calls[0][1];
    expect(Object.fromEntries(data)).toMatchObject({
      cityQuery: "ro",
      osmRef: "R41485",
      days: "2",
      pace: "balanced",
      interests: "art",
    });
    await act(async () => resolve({ error: "City search is unavailable, please retry." }));
    expect(screen.getByRole("alert").textContent).toBe("City search is unavailable, please retry.");
    expect(screen.getByRole("button", { name: "Start swiping" })).toBeTruthy();
  });

  it("shows a connection error instead of crashing when the server can't be reached", async () => {
    // Regression: a rejected form action (offline) crashed the page (no error boundary here).
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(createTripAction).mockRejectedValue(new TypeError("Failed to fetch"));
    const user = userEvent.setup();
    render(<TripSetupForm />);
    await user.type(input(), "ro");
    await waitFor(() => expect(options()).toHaveLength(2));
    await user.click(options()[0]);
    await user.click(screen.getByRole("button", { name: "Start swiping" }));
    expect((await screen.findByRole("alert")).textContent).toBe(CONNECTION_ERROR);
    expect(screen.getByRole("button", { name: "Start swiping" })).toBeTruthy();
  });
});
