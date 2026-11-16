"use client";

import { useEffect, useMemo } from "react";
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

export default function ItineraryMap({
  stops,
  center,
  selectedId,
  onSelect,
}: {
  stops: readonly MapStop[];
  center: LatLon;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
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
