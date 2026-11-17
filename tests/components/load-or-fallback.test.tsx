import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { loadOrFallback } from "@/components/load-or-fallback";

function Map({ label }: { label: string }) {
  return <p>{label}</p>;
}

describe("loadOrFallback", () => {
  it("returns the loaded component", async () => {
    const Loaded = await loadOrFallback(async () => ({ default: Map }), "the map")();
    render(<Loaded label="Leaflet map" />);
    expect(screen.getByText("Leaflet map")).toBeTruthy();
  });

  it("explains what is missing when the code cannot be loaded, instead of throwing", async () => {
    // Regression: offline, opening the map or the assistant replaced the whole page.
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const failure = new Error("Failed to load chunk");
    const Loaded = await loadOrFallback<{ label: string }>(
      () => Promise.reject(failure),
      "the map",
    )();
    render(<Loaded label="Leaflet map" />);
    expect(screen.getByRole("alert").textContent).toBe(
      "Couldn't load the map. Check your connection and reload the page.",
    );
    expect(log).toHaveBeenCalledWith("Could not load the map", failure);
  });
});
