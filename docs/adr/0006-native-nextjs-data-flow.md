# 0006 – Native Next.js data flow, no client data library

- Status: Accepted
- Date: 2026-11-16

## Context

The UI reads trips, decks and itineraries from SQLite and changes them often (every swipe,
quick action or chat tool call). It must feel instant on low-end phones and keep the initial
JavaScript under 200 KB gzipped.

## Decision

Use what Next.js (App Router) and React provide:

- **Server Components** read from SQLite (after `await connection()`).
- **Server Actions** (validated with Zod, rate limited) handle swipes, undo, review, planning
  and quick actions, with `revalidatePath`.
- **`useOptimistic`** updates the UI at once; on error it rolls back and shows a toast.
- **Agent edits** stream a `trip-updated` data part; the client calls `router.refresh()`.

## Alternatives

- **TanStack Query or SWR + REST routes**: mature caching, but a second data layer to keep in
  sync with Server Components, plus more client JavaScript.
- **React Router / a client-side SPA**: loses streaming Server Components.

## Consequences

- No API layer to maintain besides `/api/chat` (streaming), `/api/cities` and `/api/health`.
- Client components must not import Zod; schemas live in `*-schemas.ts` modules, which keeps
  the bundles within budget.
- Next.js 16 semantics (Cache Components, prerendering) must be followed carefully; the
  bundled docs are the reference.
