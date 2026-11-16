/**
 * Deterministic place ranking. Workflow A ranks the city pool by the trip's interests;
 * M2 (F8) adds swipe-learned tag weights on top of the same score.
 */
export type RankablePlace = {
  name: string;
  category: string;
  tags: readonly string[];
  popularity: number;
};

/** Weight of one matching interest relative to popularity (0..1). */
const INTEREST_WEIGHT = 0.5;

/** Popularity on a log scale normalized to 0..1 against the most popular place in the list. */
function popularityScores(places: readonly RankablePlace[]): number[] {
  const logs = places.map((p) => Math.log10(Math.max(0, p.popularity) + 1));
  const max = Math.max(1, ...logs);
  return logs.map((l) => l / max);
}

export function interestMatches(place: RankablePlace, interests: readonly string[]): number {
  if (interests.length === 0) return 0;
  const own = new Set([...place.tags, place.category]);
  return interests.filter((i) => own.has(i)).length;
}

/** Returns a new array sorted by score (desc), ties broken by name for stable output. */
export function rankByInterests<T extends RankablePlace>(
  places: readonly T[],
  interests: readonly string[],
): T[] {
  const pop = popularityScores(places);
  return places
    .map((place, i) => ({
      place,
      score: pop[i] + INTEREST_WEIGHT * interestMatches(place, interests),
    }))
    .sort((a, b) => b.score - a.score || a.place.name.localeCompare(b.place.name))
    .map((s) => s.place);
}
