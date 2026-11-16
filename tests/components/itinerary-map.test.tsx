import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ItineraryMap, { type MapStop } from "@/components/map/itinerary-map";

/**
 * react-leaflet needs a real layout engine; a light stand-in records what the component asks
 * of the map (fit, pan) and renders markers as buttons so clicks can be simulated.
 */
const leaflet = vi.hoisted(() => ({
  inView: true,
  map: {
    setView: vi.fn(),
    fitBounds: vi.fn(),
    panTo: vi.fn(),
    getBounds: vi.fn(),
  },
}));
vi.mock("react-leaflet", () => ({
  MapContainer: ({ children }: { children: ReactNode }) => <div data-testid="map">{children}</div>,
  TileLayer: ({ url, attribution }: { url: string; attribution: string }) => (
    <div data-testid="tiles" data-url={url} data-attribution={attribution} />
  ),
  Polyline: ({ positions }: { positions: [number, number][] }) => (
    <div data-testid="route" data-points={JSON.stringify(positions)} />
  ),
  Marker: ({
    title,
    icon,
    zIndexOffset,
    eventHandlers,
  }: {
    title: string;
    icon: { options: { html: string } };
    zIndexOffset: number;
    eventHandlers: { click: () => void };
  }) => (
    <button data-html={icon.options.html} data-z={zIndexOffset} onClick={eventHandlers.click}>
      {title}
    </button>
  ),
  useMap: () => leaflet.map,
}));

const center = { lat: 41.9, lon: 12.5 };
const colosseum: MapStop = { id: "a", number: 1, name: "Colosseum", lat: 41.89, lon: 12.49 };
const forum: MapStop = { id: "b", number: 2, name: "Forum", lat: 41.892, lon: 12.485 };

beforeEach(() => {
  leaflet.inView = true;
  for (const fn of Object.values(leaflet.map)) fn.mockReset();
  leaflet.map.getBounds.mockImplementation(() => ({ contains: () => leaflet.inView }));
});

describe("ItineraryMap (F5)", () => {
  it("shows OpenStreetMap tiles with attribution", () => {
    render(<ItineraryMap stops={[]} center={center} selectedId={null} onSelect={() => {}} />);
    const tiles = screen.getByTestId("tiles");
    expect(tiles.dataset.url).toBe("https://tile.openstreetmap.org/{z}/{x}/{y}.png");
    expect(tiles.dataset.attribution).toContain("OpenStreetMap");
  });

  it("centres on the city when the day is empty and zooms in on a single stop", () => {
    const { rerender } = render(
      <ItineraryMap stops={[]} center={center} selectedId={null} onSelect={() => {}} />,
    );
    expect(leaflet.map.setView).toHaveBeenLastCalledWith([41.9, 12.5], 13, { animate: false });
    expect(screen.queryByTestId("route")).toBeNull();
    rerender(
      <ItineraryMap stops={[colosseum]} center={center} selectedId={null} onSelect={() => {}} />,
    );
    expect(leaflet.map.setView).toHaveBeenLastCalledWith([41.89, 12.49], 15, { animate: false });
  });

  it("draws numbered markers and the route, and fits the day without animation", () => {
    render(
      <ItineraryMap
        stops={[colosseum, forum]}
        center={center}
        selectedId={null}
        onSelect={() => {}}
      />,
    );
    const markers = screen.getAllByRole("button");
    expect(markers.map((m) => m.textContent)).toEqual(["1. Colosseum", "2. Forum"]);
    expect(markers[0].dataset.html).toBe('<span class="itinerary-marker">1</span>');
    expect(JSON.parse(screen.getByTestId("route").dataset.points!)).toEqual([
      [41.89, 12.49],
      [41.892, 12.485],
    ]);
    const [bounds, options] = leaflet.map.fitBounds.mock.calls[0];
    expect(bounds.getSouthWest()).toMatchObject({ lat: 41.89, lng: 12.485 });
    expect(options).toEqual({ padding: [32, 32], animate: false });
  });

  it("refits only when the stops change, not when the selection does", () => {
    const props = { stops: [colosseum, forum], center, onSelect: () => {} };
    const { rerender } = render(<ItineraryMap {...props} selectedId={null} />);
    rerender(<ItineraryMap {...props} selectedId="b" />);
    expect(leaflet.map.fitBounds).toHaveBeenCalledTimes(1);
    rerender(<ItineraryMap {...props} stops={[forum, colosseum]} selectedId="b" />);
    expect(leaflet.map.fitBounds).toHaveBeenCalledTimes(2);
  });

  it("highlights the selected stop and pans to it only when it is out of view", () => {
    const props = { stops: [colosseum, forum], center, onSelect: () => {} };
    const { rerender } = render(<ItineraryMap {...props} selectedId="b" />);
    const selected = screen.getByRole("button", { name: "2. Forum" });
    expect(selected.dataset.html).toBe('<span class="itinerary-marker is-selected">2</span>');
    expect(selected.dataset.z).toBe("1000");
    expect(leaflet.map.panTo).not.toHaveBeenCalled();
    leaflet.inView = false;
    rerender(<ItineraryMap {...props} selectedId="a" />);
    expect(leaflet.map.panTo).toHaveBeenCalledWith([41.89, 12.49], { animate: false });
  });

  it("reports marker clicks for list sync", () => {
    const onSelect = vi.fn();
    render(
      <ItineraryMap
        stops={[colosseum, forum]}
        center={center}
        selectedId={null}
        onSelect={onSelect}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "2. Forum" }));
    expect(onSelect).toHaveBeenCalledWith("b");
  });
});
