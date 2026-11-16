# TravelSwipe AI

Discover a city by swiping through its attractions, then let an AI agent turn your picks into a realistic day-by-day itinerary — and refine it by chatting.

> Demo project: full-stack TypeScript web app with generative AI (LangChain.js + LangGraph.js). Work in progress.

## Stack

- **Next.js** (App Router, Server Actions) + TypeScript + Tailwind CSS
- **LangChain.js v1 / LangGraph.js** for the agent and itinerary workflow, **LangSmith** for tracing and evals
- **OpenRouter** free models as the LLM provider
- **SQLite** via **Drizzle ORM** + `better-sqlite3` (prebuilt binaries — no database server or build tools needed)

## Quickstart

Requirements: Node.js 24+. Nothing else to install.

```bash
npm install
cp .env.example .env.local   # LLM_MODE=fake works offline without API keys
npm run db:migrate
npm run db:seed              # optional, see "Seeding demo cities" below
npm run dev                  # http://localhost:3000  (health check: /api/health)
```

## Seeding demo cities

Each city's attractions are discovered once (one LLM call, then Wikipedia/Commons grounding)
and stored in SQLite as a shared pool; every later trip to that city is served from the
database without calling the LLM. `npm run db:seed` runs this discovery ahead of time for
~25 popular cities, so demos never wait for the model or run out of the free quota.

**When to run it:** after `npm run db:migrate` on a fresh database, or whenever `data/app.db`
has been deleted. It is optional: cities that were not seeded are discovered on first use.

**Requirements and cost:**

- `LLM_MODE=live` and `OPENROUTER_API_KEY` in `.env.local`. In `LLM_MODE=fake` only the
  fixture cities (Rome, Paris, see `src/server/ai/fake.ts`) get places; the others fail with
  "No verifiable attractions found".
- One OpenRouter request per new city. A full run uses ~25 of the ~50 free daily requests,
  so consider seeding in batches across days.
- Network access to Photon, Wikipedia and Wikimedia Commons (free, no keys).

**Usage:**

```bash
npm run db:seed                            # all demo cities
npm run db:seed -- --cities Rome,Florence  # a subset (names as listed in scripts/seed.ts)
```

**Behaviour:**

- **Resumable:** cities that already have places are reported as `cached` and skipped without
  any request, so re-running after a failure or a quota error only retries the missing ones.
  The exit code is non-zero if any city failed.
- **Retries are cheap:** the LLM answer is stored in `llm_cache` (30 days) before Wikipedia
  is queried, so a retry after a network error does not spend another LLM request.
- Candidates without a Wikipedia article with coordinates, farther than 30 km from the
  centre, or duplicated are dropped; photos are kept only with a known Commons license.
- Wikipedia data older than 90 days is refreshed automatically on the next visit (no LLM call).

**Maintenance:**

- **Add a city:** append `[name, ISO country code]` to `DEMO_CITIES` in `scripts/seed.ts`
  (the country code picks the right match among homonyms), then run
  `npm run db:seed -- --cities <name>`.
- **Re-discover a city** (e.g. after changing the discovery prompt): delete its places, e.g.
  with `npm run db:studio`, then seed it again. **Warning:** deleting places also deletes
  (via `ON DELETE CASCADE`) every swipe that existing trips recorded on them. Changing the prompt or the model automatically
  invalidates `llm_cache`.
- **Start over:** delete `data/app.db*`, then `npm run db:migrate && npm run db:seed`.

## Tracing with LangSmith (optional)

Every LLM call (e.g. `discover_places`, tagged `workflow-a`) can be traced to
[LangSmith](https://smith.langchain.com) on the free Developer plan. LangChain reads the
`LANGSMITH_*` variables by itself; the app only validates them at startup.

1. In LangSmith, set up tracing for an agent and copy the values it shows into `.env.local`:
   `LANGSMITH_API_KEY`, `LANGSMITH_AGENT_ID`, `LANGSMITH_AGENT_ENVIRONMENT` and, for EU
   workspaces, `LANGSMITH_ENDPOINT`.
2. Set `LANGSMITH_TRACING=true`. Do not also set `LANGSMITH_PROJECT`: the SDK traces either to
   an agent or to a project, and stops tracing if both are set (startup fails with a clear error).
3. Run anything that calls the model in `LLM_MODE=live`, e.g. `npm run db:seed -- --cities Rome`;
   the run appears under the agent in LangSmith. Fake mode is traced too, at no quota cost.

Traces contain prompts and model outputs (city names and attraction lists, no personal data).

## Scripts

| Command                                            | Purpose                                                                                                         |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `npm run dev` / `build` / `start`                  | Next.js dev server, production build, production server                                                         |
| `npm test`                                         | Vitest unit + integration tests (offline, `LLM_MODE=fake`)                                                      |
| `npm run test:e2e`                                 | Playwright smoke tests on mobile + desktop (after `npm run build`; first run `npx playwright install chromium`) |
| `npm run lint` / `typecheck` / `format`            | Code quality                                                                                                    |
| `npm run db:generate` / `db:migrate` / `db:studio` | Drizzle migrations and DB browser                                                                               |
| `npm run db:seed`                                  | Discovers and caches the places of ~25 demo cities; resumable, `-- --cities Rome,Paris` for a subset            |
| `npm run spike:llm`                                | Checks chat, tool calling and structured output on the configured OpenRouter model (needs API key)              |
