import { slugify } from "@/lib/places";

/**
 * The agent names places, it never passes IDs (§ AGENTS.md: never trust IDs from model
 * arguments). Names are resolved here, deterministically, against the trip's own places only.
 */

export type NameMatch<T> =
  { kind: "found"; item: T } | { kind: "ambiguous"; items: T[] } | { kind: "none" };

/** Exact name (accents, case and punctuation ignored), else a unique partial match. */
export function matchByName<T extends { name: string }>(
  items: readonly T[],
  query: string,
): NameMatch<T> {
  const q = slugify(query);
  if (!q) return { kind: "none" };
  const exact = items.filter((i) => slugify(i.name) === q);
  if (exact.length === 1) return { kind: "found", item: exact[0] };
  const partial = exact.length
    ? exact
    : items.filter((i) => {
        const name = slugify(i.name);
        return name.includes(q) || q.includes(name);
      });
  if (partial.length === 1) return { kind: "found", item: partial[0] };
  return partial.length ? { kind: "ambiguous", items: partial } : { kind: "none" };
}

/** Tool reply for a name that did not resolve to exactly one place. */
export function describeMiss<T extends { name: string }>(
  match: Exclude<NameMatch<T>, { kind: "found" }>,
  query: string,
  where: string,
): string {
  if (match.kind === "ambiguous") {
    const names = match.items.slice(0, 5).map((i) => i.name);
    return `"${query}" matches several places ${where}: ${names.join(", ")}. Ask which one.`;
  }
  return `No place called "${query}" ${where}.`;
}
