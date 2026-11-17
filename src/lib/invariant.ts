/**
 * Defensive programming (AGENTS.md): unwraps a value the code guarantees to exist, failing
 * loudly with a clear message instead of a non-null assertion (`!`) that would let `undefined`
 * travel on. Use it only for internal invariants; untrusted data is validated at its boundary.
 */
export function defined<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`Invariant failed: missing ${what}.`);
  return value;
}
