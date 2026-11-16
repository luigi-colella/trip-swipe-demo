import type { PlannerPlace } from "@/server/itinerary/fallback";

/** Real Rome coordinates for planner tests: [name, lat, lon, visit minutes, popularity]. */
const ROME: [string, number, number, number, number][] = [
  ["Colosseum", 41.8902, 12.4922, 120, 9000],
  ["Roman Forum", 41.8925, 12.4853, 90, 6000],
  ["Pantheon", 41.8986, 12.4769, 30, 7000],
  ["Trevi Fountain", 41.9009, 12.4833, 20, 6500],
  ["Spanish Steps", 41.906, 12.4828, 20, 5000],
  ["Piazza Navona", 41.8992, 12.4731, 30, 4500],
  ["Vatican Museums", 41.9065, 12.4536, 180, 8000],
  ["St. Peter's Basilica", 41.9022, 12.4539, 90, 7500],
  ["Castel Sant'Angelo", 41.9031, 12.4663, 90, 4000],
  ["Galleria Borghese", 41.9142, 12.4921, 120, 3000],
  ["Trastevere", 41.8897, 12.47, 120, 3500],
  ["Ostia Antica", 41.7556, 12.2919, 180, 1500],
];

/** Planner places with deterministic IDs ("colosseum", …); `must` lists must-see names. */
export function romePlaces(
  names?: readonly string[],
  must: readonly string[] = [],
): PlannerPlace[] {
  return ROME.filter(([name]) => !names || names.includes(name)).map(
    ([name, lat, lon, visitMinutes, popularity]) => ({
      id: name.toLowerCase().replace(/[^a-z]+/g, "-"),
      name,
      category: "landmark",
      lat,
      lon,
      visitMinutes,
      popularity,
      must: must.includes(name),
    }),
  );
}
