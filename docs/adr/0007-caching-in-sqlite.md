# 0007 – Cache in SQLite; exact-match LLM cache, no semantic cache

- Status: Accepted
- Date: 2026-11-16

## Context

Third-party APIs (Photon, Wikipedia, Wikimedia Commons) are free but should be used lightly,
and LLM requests are the scarcest resource of the app
([0003](0003-openrouter-free-models-only.md)).

## Decision

- **Domain data as cache**: each city's places are discovered once and stored as a shared
  pool; `npm run db:seed` precomputes ~25 demo cities. Wikipedia data older than 90 days is
  refreshed without an LLM call.
- **`http_cache` table**: raw third-party responses with a TTL (Photon 30 days, Wikipedia
  summaries 7 days); an in-memory LRU in front of it for autocomplete only.
- **`llm_cache` table**: a LangChain `BaseCache` with exact-match keys (30 days), only for the
  `discovery` and `planner` roles. Changing the prompt or the model changes the key.
- Browser caching (`Cache-Control` on GETs) and a 250 ms debounce on autocomplete.

## Alternatives

- **Semantic cache**: answers depend on the trip's state, and similar cities would produce
  false hits. Rejected.
- **Redis** or another cache server: something to install ([0001](0001-run-locally-only.md)).
- **Next.js Data Cache**: zero code, but its semantics changed across versions.

## Consequences

- Seeded cities never call the LLM again; a retried seed does not spend another request.
- Chat turns are not cached (they depend on state); they stay lean instead: a compact trip
  snapshot each turn and the last 12 messages.
- Caches are inspectable with `npm run db:studio` and reset by deleting rows.
