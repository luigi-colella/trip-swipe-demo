import type { PlaceCard } from "./places";
import { computeTagWeights, rankPlaces, rerankDeck } from "./ranking";
import type { SwipeDecision } from "./trip";

/**
 * Client-side swipe deck state (F3, F8). Pure reducer: the UI applies changes instantly and
 * persists them in the background; failed writes are rolled back with the inverse action.
 */

export type DeckEntry = { place: PlaceCard; decision: SwipeDecision };

export type DeckState = {
  /** Places not swiped yet; index 0 is the top card. */
  deck: PlaceCard[];
  /** Swipes in order: the undo stack. */
  history: DeckEntry[];
  interests: readonly string[];
};

/** Cards that keep their position on re-rank: the ones already visible under the top card. */
export const PINNED_CARDS = 2;

export type DeckAction =
  | { type: "swipe"; placeId: string; decision: SwipeDecision }
  | { type: "undo"; placeId: string }
  /** Rolls back a swipe the server rejected (wherever it is in the history). */
  | { type: "revert-swipe"; placeId: string }
  /** Rolls back an undo the server rejected. */
  | { type: "revert-undo"; entry: DeckEntry }
  | { type: "append"; places: PlaceCard[] };

function weightsOf(history: readonly DeckEntry[]) {
  return computeTagWeights(history);
}

export function deckReducer(state: DeckState, action: DeckAction): DeckState {
  switch (action.type) {
    case "swipe": {
      const place = state.deck.find((p) => p.id === action.placeId);
      if (!place) return state;
      const history = [...state.history, { place, decision: action.decision }];
      const rest = state.deck.filter((p) => p.id !== place.id);
      return {
        ...state,
        history,
        deck: rerankDeck(rest, PINNED_CARDS, {
          interests: state.interests,
          weights: weightsOf(history),
        }),
      };
    }
    case "undo": {
      const last = state.history.at(-1);
      if (!last || last.place.id !== action.placeId) return state;
      return { ...state, history: state.history.slice(0, -1), deck: [last.place, ...state.deck] };
    }
    case "revert-swipe": {
      const entry = state.history.find((e) => e.place.id === action.placeId);
      if (!entry) return state;
      return {
        ...state,
        history: state.history.filter((e) => e !== entry),
        deck: [entry.place, ...state.deck],
      };
    }
    case "revert-undo": {
      const { entry } = action;
      if (!state.deck.some((p) => p.id === entry.place.id)) return state;
      return {
        ...state,
        history: [...state.history, entry],
        deck: state.deck.filter((p) => p.id !== entry.place.id),
      };
    }
    case "append": {
      const known = new Set([...state.deck, ...state.history.map((e) => e.place)].map((p) => p.id));
      const fresh = action.places.filter((p) => !known.has(p.id));
      if (fresh.length === 0) return state;
      const ranked = rankPlaces(fresh, {
        interests: state.interests,
        weights: weightsOf(state.history),
      });
      return { ...state, deck: [...state.deck, ...ranked] };
    }
  }
}

export function shortlistCount(history: readonly DeckEntry[]): number {
  return history.filter((e) => e.decision !== "skip").length;
}

/**
 * Identifies the server's view of a deck. The deck keeps its own state after the first render,
 * so a change made elsewhere (the chat agent) must remount it: its `key` changes whenever the
 * swipes or the size of the pool change. djb2 hash, short and stable.
 */
export function deckVersion(deck: readonly PlaceCard[], history: readonly DeckEntry[]): string {
  const source = `${deck.length}|${history.map((e) => `${e.place.id}:${e.decision}`).join(",")}`;
  let hash = 5381;
  for (let i = 0; i < source.length; i++) hash = ((hash << 5) + hash + source.charCodeAt(i)) | 0;
  return (hash >>> 0).toString(36);
}
