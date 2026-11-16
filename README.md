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

## Itinerary planning

"Generate itinerary" turns the shortlist into a day-by-day plan with a LangGraph workflow
(`src/server/itinerary/graph.ts`): code clusters nearby places into days and drafts a feasible
plan, the planner model refines it (titles, order, tips, what to leave out), and a validator
checks it. Invalid answers get up to two repair rounds; if the model still fails, or the
provider is unavailable, the deterministic draft is used and labelled "Planned by rules".

- **Cost:** 1 OpenRouter request per plan (up to 3 with repairs). The first plan for a given
  shortlist is cached in `llm_cache`; "New plan" always asks the model again.
- **Schedule rules:** days start at 09:00; travel is estimated from straight-line distance
  × 1.3 (walking up to 2 km at 4.5 km/h, otherwise public transport at 20 km/h + 10 min);
  a 60-minute lunch break follows the stop in progress at 12:30. The pace sets the daily
  visits + travel budget (6/8/10 h). Must-see places are never left out.
- **Quick actions** (move, change day, remove) and undo are deterministic and instant; every
  change is saved as a new version, and undo steps back one version.
- The map uses OpenStreetMap tiles (free, attribution shown, light use only); each day can be
  opened in Google Maps as walking directions.

## Chat assistant

The trip assistant is on every page: a pane on the right on desktop (it can be hidden), a
bottom sheet opened from the round button on mobile. It is a LangChain agent
(`src/server/agent/agent.ts`) with six tools: `set_trip`, `find_more_places`, `add_place`,
`remove_place`, `edit_itinerary` and `regenerate_itinerary`. Tools change the trip and the
page updates immediately; itinerary edits are new versions, so Undo works as for quick actions.

- **Conversation:** stored per trip in SQLite by the LangGraph checkpointer and shown again
  when the trip is reopened. The home-page chat stores nothing until it creates a trip; that
  conversation then continues in the new trip.
- **Safety:** the agent only acts on the trip open in the page and refers to places by name
  (code resolves them); messages are limited to 500 characters; each turn makes at most 4
  model calls and 3 tool calls; the model sees the current trip state plus the last 12
  messages.
- **Cost:** about 2 OpenRouter requests per turn that changes the trip (decide, then reply),
  1 for a plain answer; `regenerate_itinerary` and `find_more_places` add their own planner
  or discovery request. Adding a place to an existing itinerary needs no extra request.
- **Offline:** with `LLM_MODE=fake` a scripted model understands simple commands such as
  "Plan a trip to Rome for 2 days", "Add the Colosseum", "Move Pantheon to day 2",
  "Remove Trevi Fountain", "Find more places" and "Plan a new itinerary"
  (`src/server/ai/fake-agent.ts`).

## Tracing with LangSmith (optional)

Every LLM call (e.g. `discover_places`, tagged `workflow-a`, or the `itinerary_planner` graph, tagged `workflow-b`) can be traced to
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
| `npm test`                                         | Vitest unit, integration and component tests (offline, `LLM_MODE=fake`)                                         |
| `npm run test:coverage`                            | The same tests with coverage; fails below 100% of `src/`                                                        |
| `npm run test:e2e`                                 | Playwright smoke tests on mobile + desktop (after `npm run build`; first run `npx playwright install chromium`) |
| `npm run test:e2e:update-screenshots`              | Regenerates the screenshot references (Windows only for now) after an intended UI change                        |
| `npm run lint` / `typecheck` / `format`            | Code quality                                                                                                    |
| `npm run db:generate` / `db:migrate` / `db:studio` | Drizzle migrations and DB browser                                                                               |
| `npm run db:seed`                                  | Discovers and caches the places of ~25 demo cities; resumable, `-- --cities Rome,Paris` for a subset            |
| `npm run spike:llm`                                | Checks chat, tool calling and structured output on the configured OpenRouter model (needs API key)              |
