/**
 * Controlled vocabulary for places. The LLM proposes free text; code normalizes it to these
 * values so that interests (F1) and swipe-learned weights (F8) work across cities.
 */
export const PLACE_CATEGORIES = [
  "landmark",
  "museum",
  "historic-site",
  "religious-site",
  "palace",
  "park",
  "viewpoint",
  "neighborhood",
  "market",
  "entertainment",
] as const;
export type PlaceCategory = (typeof PLACE_CATEGORIES)[number];

export const PLACE_TAGS = [
  "history",
  "art",
  "architecture",
  "religion",
  "nature",
  "views",
  "food",
  "shopping",
  "nightlife",
  "family",
  "science",
  "music",
  "local-life",
  "iconic",
  "hidden-gem",
] as const;
export type PlaceTag = (typeof PLACE_TAGS)[number];

/** Tags a user can pick as interests in the trip setup. */
export const INTEREST_TAGS = PLACE_TAGS.filter((t) => t !== "iconic" && t !== "hidden-gem");

const MIN_VISIT_MINUTES = 15;
const MAX_VISIT_MINUTES = 300;
const MAX_PITCH_LENGTH = 160;
const MAX_NAME_LENGTH = 80;

function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function normalizeCategory(value: string): PlaceCategory {
  const slug = slugify(value);
  return (PLACE_CATEGORIES as readonly string[]).includes(slug)
    ? (slug as PlaceCategory)
    : "landmark";
}

/** Keeps known tags only, deduplicated, in vocabulary order. */
export function normalizeTags(values: readonly string[]): PlaceTag[] {
  const wanted = new Set(values.map(slugify));
  return PLACE_TAGS.filter((t) => wanted.has(t));
}

/** Rounds to 15-minute steps within a sane range; defaults to one hour. */
export function normalizeVisitMinutes(value: number): number {
  if (!Number.isFinite(value)) return 60;
  const rounded = Math.round(value / 15) * 15;
  return Math.min(MAX_VISIT_MINUTES, Math.max(MIN_VISIT_MINUTES, rounded));
}

/** Collapses whitespace and cuts at a word boundary with an ellipsis. */
export function truncateText(value: string, max: number): string {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max / 2 ? cut.slice(0, lastSpace) : cut).replace(/[\s,.;:]+$/, "")}…`;
}

export function normalizePitch(value: string): string {
  return truncateText(value, MAX_PITCH_LENGTH);
}

export function normalizeName(value: string): string {
  return truncateText(value, MAX_NAME_LENGTH);
}

export { slugify };
