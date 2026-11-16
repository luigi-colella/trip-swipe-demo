import { estimateLeg, type LatLon } from "@/lib/geo";

/**
 * Deterministic day planning helpers (§3.3 B "cluster"): pick what fits, group nearby places
 * into days and order each day's route. Small inputs (≤ ~40 places), so simple exact-enough
 * heuristics beat clever ones: k-means with farthest-point seeding, a capacity rebalancing
 * pass, nearest-neighbour routes improved by 2-opt.
 */

export type ClusterPlace = LatLon & {
  id: string;
  visitMinutes: number;
  must: boolean;
  popularity: number;
};

/** Average travel time assumed per place when estimating how many places fit. */
export const ESTIMATED_LEG_MINUTES = 15;

const byPriority = (a: ClusterPlace, b: ClusterPlace) =>
  Number(b.must) - Number(a.must) || b.popularity - a.popularity || a.id.localeCompare(b.id);

/**
 * Keeps every must-see and as many liked places as the trip can hold, most popular first.
 * Returns the rest as excluded.
 */
export function selectPlaces<T extends ClusterPlace>(
  places: readonly T[],
  budgetMinutes: number,
): { kept: T[]; excluded: T[] } {
  const kept: T[] = [];
  const excluded: T[] = [];
  let used = 0;
  for (const p of [...places].sort(byPriority)) {
    const cost = p.visitMinutes + ESTIMATED_LEG_MINUTES;
    if (p.must || used + cost <= budgetMinutes) {
      kept.push(p);
      used += cost;
    } else {
      excluded.push(p);
    }
  }
  return { kept, excluded };
}

/** Equirectangular projection around the group's mean latitude (fine at city scale). */
function project(places: readonly LatLon[]): [number, number][] {
  const meanLat = places.reduce((s, p) => s + p.lat, 0) / Math.max(1, places.length);
  const k = Math.cos((meanLat * Math.PI) / 180);
  return places.map((p) => [p.lon * k, p.lat]);
}

const dist2 = (a: [number, number], b: [number, number]) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;

function centroid(points: readonly [number, number][]): [number, number] {
  const n = Math.max(1, points.length);
  return [points.reduce((s, p) => s + p[0], 0) / n, points.reduce((s, p) => s + p[1], 0) / n];
}

/** Splits places into at most `k` geographic groups (k-means, deterministic seeding). */
export function clusterPlaces<T extends ClusterPlace>(places: readonly T[], k: number): T[][] {
  if (places.length === 0 || k <= 0) return [];
  const sorted = [...places].sort(byPriority);
  const pts = project(sorted);
  const groups = Math.min(k, sorted.length);

  // Farthest-point seeding from the top-priority place.
  const seeds = [0];
  while (seeds.length < groups) {
    let best = -1;
    let bestD = -1;
    pts.forEach((p, i) => {
      const d = Math.min(...seeds.map((s) => dist2(p, pts[s])));
      if (d > bestD) [best, bestD] = [i, d];
    });
    seeds.push(best);
  }
  let centers = seeds.map((s) => pts[s]);
  let assignment = pts.map(() => 0);
  for (let iter = 0; iter < 25; iter++) {
    const next = pts.map((p) => {
      let best = 0;
      centers.forEach((c, j) => {
        if (dist2(p, c) < dist2(p, centers[best])) best = j;
      });
      return best;
    });
    const stable = next.every((g, i) => g === assignment[i]);
    assignment = next;
    centers = centers.map((c, j) => {
      const members = pts.filter((_, i) => assignment[i] === j);
      return members.length ? centroid(members) : c;
    });
    if (stable && iter > 0) break;
  }
  const result: T[][] = centers.map(() => []);
  sorted.forEach((p, i) => result[assignment[i]].push(p));
  return result.filter((g) => g.length > 0);
}

/** Travel minutes along a route, in the given order. */
export function travelMinutes(route: readonly ClusterPlace[]): number {
  let total = 0;
  for (let i = 1; i < route.length; i++) total += estimateLeg(route[i - 1], route[i]).minutes;
  return total;
}

/** Visits + travel along the best route through the group. */
export function groupMinutes(group: readonly ClusterPlace[]): number {
  return group.reduce((s, p) => s + p.visitMinutes, 0) + travelMinutes(orderRoute(group));
}

/**
 * Moves places from days over budget to the nearest day with room, until nothing improves.
 * Groups are padded to `days` so that empty days can receive places too.
 */
export function rebalanceGroups<T extends ClusterPlace>(
  input: readonly T[][],
  days: number,
  budgetMinutes: number,
): T[][] {
  const groups = input.map((g) => [...g]);
  while (groups.length < days) groups.push([]);
  for (let iter = 0; iter < 100; iter++) {
    const loads = groups.map(groupMinutes);
    const from = loads.indexOf(Math.max(...loads));
    if (loads[from] <= budgetMinutes) break;
    let move: { place: T; to: number; d: number } | undefined;
    for (const [to, target] of groups.entries()) {
      if (to === from) continue;
      for (const place of groups[from]) {
        if (groupMinutes([...target, place]) > budgetMinutes) continue;
        const d = target.length
          ? Math.min(...target.map((t) => estimateLeg(t, place).km))
          : Number.MAX_SAFE_INTEGER / 2;
        if (!move || d < move.d) move = { place, to, d };
      }
    }
    if (!move) break;
    groups[from] = groups[from].filter((p) => p !== move.place);
    groups[move.to].push(move.place);
  }
  return groups;
}

/** Shortest open route: nearest neighbour from every start, then 2-opt. */
export function orderRoute<T extends ClusterPlace>(group: readonly T[]): T[] {
  if (group.length <= 2) return [...group];
  let best: T[] = [];
  let bestCost = Infinity;
  for (const start of group) {
    const route = [start];
    const left = new Set(group.filter((p) => p !== start));
    while (left.size) {
      const last = route.at(-1)!;
      let next: T | undefined;
      for (const p of left) {
        if (!next || estimateLeg(last, p).km < estimateLeg(last, next).km) next = p;
      }
      route.push(next!);
      left.delete(next!);
    }
    const cost = routeKm(route);
    if (cost < bestCost - 1e-9) [best, bestCost] = [route, cost];
  }
  // 2-opt on the open path.
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 0; i < best.length - 1; i++) {
      for (let j = i + 1; j < best.length; j++) {
        const candidate = [
          ...best.slice(0, i),
          ...best.slice(i, j + 1).reverse(),
          ...best.slice(j + 1),
        ];
        const cost = routeKm(candidate);
        if (cost < bestCost - 1e-9) {
          [best, bestCost] = [candidate, cost];
          improved = true;
        }
      }
    }
  }
  return best;
}

function routeKm(route: readonly ClusterPlace[]): number {
  let total = 0;
  for (let i = 1; i < route.length; i++) total += estimateLeg(route[i - 1], route[i]).km;
  return total;
}
