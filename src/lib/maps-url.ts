import type { LatLon } from "./geo";

/**
 * F7 – Google Maps export with Maps URLs (no API key):
 * https://developers.google.com/maps/documentation/urls/get-started#directions-action
 * Coordinates rather than names, so the link opens exactly the place we planned.
 */

const DIRECTIONS_URL = "https://www.google.com/maps/dir/";
/** Maps URLs accept at most 9 waypoints between origin and destination. */
export const MAX_WAYPOINTS = 9;
const MAX_STOPS_PER_LINK = MAX_WAYPOINTS + 2;

const coord = (p: LatLon) => `${p.lat.toFixed(6)},${p.lon.toFixed(6)}`;

function directionsUrl(stops: readonly LatLon[]): string {
  const params = new URLSearchParams({ api: "1" });
  if (stops.length > 1) params.set("origin", coord(stops[0]));
  params.set("destination", coord(stops.at(-1)!));
  if (stops.length > 2) params.set("waypoints", stops.slice(1, -1).map(coord).join("|"));
  params.set("travelmode", "walking");
  return `${DIRECTIONS_URL}?${params.toString()}`;
}

/**
 * Walking directions through a day's stops, in order. Beyond the waypoint limit the route is
 * split into several links; each one starts where the previous one ended. A single stop gives
 * directions from the user's current location.
 */
export function googleMapsDayUrls(stops: readonly LatLon[]): string[] {
  if (stops.length === 0) return [];
  if (stops.length <= MAX_STOPS_PER_LINK) return [directionsUrl(stops)];
  const urls: string[] = [];
  for (let start = 0; start < stops.length - 1; start += MAX_STOPS_PER_LINK - 1) {
    urls.push(directionsUrl(stops.slice(start, start + MAX_STOPS_PER_LINK)));
  }
  return urls;
}
