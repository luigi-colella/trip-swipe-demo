"use client";

import { useEffect, useMemo, useState } from "react";
import { divIcon, latLngBounds } from "leaflet";
import { MapContainer, Marker, Polyline, TileLayer, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import type { LatLon } from "@/lib/geo";

/**
 * F5 – Map of one day: numbered markers in visiting order and the route between them.
 * Loaded lazily (Leaflet is ~40 KB gz) and only rendered in the browser.
 */

export type MapStop = LatLon & { id: string; number: number; name: string };

const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/** Numbers only in the HTML: names go through Leaflet's `title`, never through innerHTML. */
function numberIcon(n: number, selected: boolean) {
  return divIcon({
    className: "",
    html: `<span class="itinerary-marker${selected ? " is-selected" : ""}">${n}</span>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

function FitToStops({ stops, center }: { stops: readonly MapStop[]; center: LatLon }) {
  const map = useMap();
  const key = stops.map((s) => s.id).join();
  useEffect(() => {
    // No animation: an animated move still running when the map unmounts (tab switch,
    // navigation) makes Leaflet throw "Cannot read properties of undefined (_leaflet_pos)".
    if (stops.length === 0) map.setView([center.lat, center.lon], 13, { animate: false });
    else if (stops.length === 1) map.setView([stops[0].lat, stops[0].lon], 15, { animate: false });
    else {
      map.fitBounds(latLngBounds(stops.map((s) => [s.lat, s.lon])), {
        padding: [32, 32],
        animate: false,
      });
    }
    // Refit only when the day's stops change, not when the selection does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, key]);
  return null;
}

function FollowSelection({ stop }: { stop: MapStop | undefined }) {
  const map = useMap();
  useEffect(() => {
    if (stop && !map.getBounds().contains([stop.lat, stop.lon]))
      map.panTo([stop.lat, stop.lon], { animate: false });
  }, [map, stop]);
  return null;
}

type ItineraryMapProps = {
  stops: readonly MapStop[];
  center: LatLon;
  selectedId: string | null;
  onSelect: (id: string) => void;
};

/**
 * Next.js keeps visited routes in React's <Activity> (Cache Components): hiding the page runs
 * effect cleanups, and react-leaflet's cleanup removes the Leaflet map while its instance stays
 * in state. Showing the page again re-runs the layers' effects against that removed map
 * ("Cannot read properties of undefined (reading 'appendChild')"). A new key on every
 * disconnect remounts the container, so a fresh map is created when the page is shown (React
 * renders the hidden tree's pending update at the latest when revealing it). The new map fits
 * the day's stops again, as on first load; in development, StrictMode's extra effect cycle
 * also creates the map twice.
 */
export default function ItineraryMap(props: ItineraryMapProps) {
  const [generation, setGeneration] = useState(0);
  useEffect(() => () => setGeneration((g) => g + 1), []);
  return <LeafletMap key={generation} {...props} />;
}

function LeafletMap({ stops, center, selectedId, onSelect }: ItineraryMapProps) {
  const route = useMemo(() => stops.map((s) => [s.lat, s.lon] as [number, number]), [stops]);
  return (
    <MapContainer
      center={[center.lat, center.lon]}
      zoom={13}
      className="size-full"
      scrollWheelZoom={false}
    >
      <TileLayer url={TILE_URL} attribution={ATTRIBUTION} maxZoom={19} />
      {route.length > 1 && (
        <Polyline
          positions={route}
          pathOptions={{ color: "#e11d48", weight: 3, opacity: 0.7, dashArray: "6 6" }}
        />
      )}
      {stops.map((s) => (
        <Marker
          key={s.id}
          position={[s.lat, s.lon]}
          icon={numberIcon(s.number, s.id === selectedId)}
          title={`${s.number}. ${s.name}`}
          alt={`${s.number}. ${s.name}`}
          zIndexOffset={s.id === selectedId ? 1000 : 0}
          eventHandlers={{ click: () => onSelect(s.id) }}
        />
      ))}
      <FitToStops stops={stops} center={center} />
      <FollowSelection stop={stops.find((s) => s.id === selectedId)} />
    </MapContainer>
  );
}
