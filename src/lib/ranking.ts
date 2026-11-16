/**
 * Deterministic place ranking. Workflow A ranks the city pool by the trip's interests;
 * F8 adds swipe-learned tag/category weights on top of the same score. Pure functions shared
 * by the server (initial deck) and the client (instant re-rank after each swipe).
 */
import type { SwipeDecision } from "./trip";

export type RankablePlace = {
  name: string;
  category: string;
  tags: readonly string[];
  popularity: number;
};

/** Learned weight per tag or category (the two vocabularies never overlap). */
export type TagWeights = Record<string, number>;

/** Weight of one matching interest relative to popularity (0..1). */
const INTEREST_WEIGHT = 0.5;

/** F8: how much each decision moves the weight of the place's tags and category. */
export const SWIPE_WEIGHTS: Record<SwipeDecision, number> = { like: 1, must: 2, skip: -0.5 };
/** Score per unit of learned affinity, capped so swipes re-order but never bury popularity. */
const LEARNED_WEIGHT = 0.1;
const MAX_LEARNED_SCORE = 1;

/** Popularity on a log scale normalized to 0..1 against the most popular place in the list. */
function popularityScores(places: readonly RankablePlace[]): number[] {
  const logs = places.map((p) => Math.log10(Math.max(0, p.popularity) + 1));
  const max = Math.max(1, ...logs);
  return logs.map((l) => l / max);
}

function features(place: Pick<RankablePlace, "category" | "tags">): Set<string> {
  return new Set([...place.tags, place.category]);
}

export function interestMatches(place: RankablePlace, interests: readonly string[]): number {
  if (interests.length === 0) return 0;
  const own = features(place);
  return interests.filter((i) => own.has(i)).length;
}

/** Sums the decision weights over each swiped place's tags and category (F8). */
export function computeTagWeights(
  swipes: readonly {
    decision: SwipeDecision;
    place: Pick<RankablePlace, "category" | "tags">;
  }[],
): TagWeights {
  const weights: TagWeights = {};
  for (const { decision, place } of swipes) {
    for (const f of features(place)) {
      weights[f] = (weights[f] ?? 0) + SWIPE_WEIGHTS[decision];
    }
  }
  return weights;
}

function learnedScore(place: RankablePlace, weights: TagWeights): number {
  let affinity = 0;
  for (const f of features(place)) affinity += weights[f] ?? 0;
  return Math.max(-MAX_LEARNED_SCORE, Math.min(MAX_LEARNED_SCORE, LEARNED_WEIGHT * affinity));
}

export type RankingInput = { interests?: readonly string[]; weights?: TagWeights };

/** Returns a new array sorted by score (desc), ties broken by name for stable output. */
export function rankPlaces<T extends RankablePlace>(
  places: readonly T[],
  { interests = [], weights = {} }: RankingInput,
): T[] {
  const pop = popularityScores(places);
  return places
    .map((place, i) => ({
      place,
      score:
        pop[i] + INTEREST_WEIGHT * interestMatches(place, interests) + learnedScore(place, weights),
    }))
    .sort((a, b) => b.score - a.score || a.place.name.localeCompare(b.place.name))
    .map((s) => s.place);
}

export function rankByInterests<T extends RankablePlace>(
  places: readonly T[],
  interests: readonly string[],
): T[] {
  return rankPlaces(places, { interests });
}

/**
 * Re-ranks the remaining deck after a swipe while keeping the first `pinned` cards in place:
 * they are already visible (or their photos preloaded), so moving them would make the stack
 * jump under the user's finger.
 */
export function rerankDeck<T extends RankablePlace>(
  deck: readonly T[],
  pinned: number,
  input: RankingInput,
): T[] {
  return [...deck.slice(0, pinned), ...rankPlaces(deck.slice(pinned), input)];
}
