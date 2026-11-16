/**
 * Distances and travel-time estimates between places. Pure functions shared by the server
 * (place discovery, itinerary planning and validation) and the client (instant re-scheduling
 * after a quick action). No routing service: straight-line distance times a detour factor.
 */

export type LatLon = { lat: number; lon: number };

const EARTH_RADIUS_KM = 6371;
const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in kilometres. */
export function haversineKm(a: LatLon, b: LatLon): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Streets are not straight lines: estimated route length = great-circle distance × 1.3. */
export const ROUTE_FACTOR = 1.3;
/** Routes up to this length (km) are walked; longer ones use public transport. */
export const MAX_WALK_KM = 2;
export const WALK_KMH = 4.5;
export const TRANSIT_KMH = 20;
/** Waiting and getting to/from the stop, added to every transit leg. */
export const TRANSIT_OVERHEAD_MINUTES = 10;
/** Places closer than this are "next door": no leg time. */
const SAME_SPOT_KM = 0.05;
/** Leg times are rounded up to this step so that timeline times stay readable. */
const ROUND_TO_MINUTES = 5;

export type TravelMode = "walk" | "transit";
export type Leg = { mode: TravelMode; km: number; minutes: number };

const roundUp = (minutes: number) => Math.ceil(minutes / ROUND_TO_MINUTES) * ROUND_TO_MINUTES;

/** Estimated travel between two places (§3.3 B "prepare"). `km` is the route length. */
export function estimateLeg(from: LatLon, to: LatLon): Leg {
  const km = haversineKm(from, to) * ROUTE_FACTOR;
  if (km < SAME_SPOT_KM * ROUTE_FACTOR) return { mode: "walk", km: 0, minutes: 0 };
  if (km <= MAX_WALK_KM) return { mode: "walk", km, minutes: roundUp((km / WALK_KMH) * 60) };
  return {
    mode: "transit",
    km,
    minutes: roundUp((km / TRANSIT_KMH) * 60 + TRANSIT_OVERHEAD_MINUTES),
  };
}

/** "850 m" / "3.4 km". */
export function formatDistance(km: number): string {
  if (km < 1) return `${Math.max(10, Math.round((km * 1000) / 10) * 10)} m`;
  return `${km.toFixed(1)} km`;
}
