# TripSwipe AI — Specification and Development Plan

> This is the working specification of TripSwipe AI. The owner wrote the requirements and approved
> every decision, mostly in Claude Code plan mode. Claude Code kept this document up to date and
> implemented it milestone by milestone, with no code written by hand (see "How it was built" in
> the [README](../README.md)). Owner decisions are recorded inline, with the milestone they belong to.
> The architecture decisions are also summarized as [ADRs](adr/README.md).

## Context

Demo project showcasing a **full-stack web app with generative AI**: the user picks a city and a number of days, swipes (Tinder-style) through tourist attractions, reviews the shortlist, gets a realistic itinerary and refines it by chatting with an AI agent. Inspiration: travelswipe.net.

Constraints: at most ~5 concurrent users, **$0 cost**, simple and reliable solutions, a UI that is smooth on low-end devices and free of visual glitches, **local-only first release**, **nothing to install besides Node.js** (no Docker, no database server).

### Decisions

| Topic           | Choice                                                                                                                         | Rationale                                             |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| Runtime         | **Local only**: `npm run dev` for development, `npm run build && npm start` for demos                                          | Maximum simplicity; no containers, no deployment      |
| Framework       | **Next.js (App Router) + TypeScript**                                                                                          | One project for UI and API, native streaming          |
| Frontend data   | **Native Next.js tools**: Server Components, Server Actions, `useOptimistic`, `router.refresh()`                               | No React Router, no TanStack Query                    |
| UI              | Tailwind CSS + shadcn/ui, lucide, react-leaflet                                                                                | Accessible, lightweight components                    |
| AI              | **LangChain.js v1** (`createAgent` + middleware) + **LangGraph.js**; **LangSmith** (free SaaS, optional) for tracing and evals | Showcase the LangChain ecosystem                      |
| LLM             | **OpenRouter `:free` models only** (model chosen via env); a second provider may be added later                                | Owner decision: one provider for now (Appendix A)     |
| Database        | **SQLite (`data/app.db`) + Drizzle ORM** with the **`better-sqlite3`** driver                                                  | Prebuilt binaries: no database server, no build tools |
| Agent memory    | Official **`@langchain/langgraph-checkpoint-sqlite`** (`SqliteSaver`, `thread_id = trip_id`)                                   | Official, shares the same SQLite driver               |
| Users, language | No login, anonymous trips addressed by UUID; English only                                                                      | —                                                     |
| LLM mode        | `LLM_MODE=fake` (offline, deterministic: tests, CI, UI work) · `LLM_MODE=live`                                                 | Develop without spending provider quota               |

### Database: "nothing to install" check

| Option                             | Machine requirements                                         | Drizzle support                    | LangGraph checkpointer         | Verdict                        |
| ---------------------------------- | ------------------------------------------------------------ | ---------------------------------- | ------------------------------ | ------------------------------ |
| **`better-sqlite3`**               | `npm install` only (prebuilt binaries, Windows x64 included) | Stable driver + drizzle-kit/Studio | Official `SqliteSaver`         | ✅ **Chosen** (verified in M0) |
| `node:sqlite` (built into Node 24) | Nothing, not even a native module                            | Only in Drizzle 1.0 beta           | None official → custom storage | 🔁 Plan B                      |
| `@libsql/client`                   | Prebuilt binaries via npm                                    | Stable                             | Community port only            | ❌                             |

SQLite for 5 users: **WAL** mode + `busy_timeout`, one shared connection per Next.js process (singleton on `globalThis` to survive HMR). Backup = copy the file.

---

## 1. Functional requirements

- **F1 – Trip setup** (`/`): city autocomplete (Photon/komoot), 1–7 days, pace _Relaxed / Balanced / Intense_ (6/8/10 active hours per day), optional interests.
- **F2 – Place deck**: ~30 candidates per city; each card shows a photo (Wikimedia), name, category, estimated visit time and a short pitch.
- **F3 – Swipe**: drag/fling, ✕ / ♥ / ★ (must-see) buttons, keyboard, undo, progress counter, "Load more".
- **F4 – Itinerary**: one tab per day, timeline with times, legs between stops, lunch break, excluded places with a reason, quick actions (remove, move, change day, regenerate), versions with undo.
- **F5 – Map**: numbered markers per day, polyline, list↔map sync, list/map toggle on mobile.
- **F6 – Conversational agent**, always available (also on the home page): creates/edits the trip, suggests places, edits the itinerary, explains its choices; streamed replies; the visual area updates immediately.
- **F7 – Google Maps export**: one link per day (`https://www.google.com/maps/dir/?api=1&…&travelmode=walking`), split into several links beyond the waypoint limit.
- **F8 – Swipe-learned ranking**: per tag/category weights (like +1, must +2, skip −0.5) re-rank the remaining deck instantly; deterministic.
- **F9 – Provenance on cards**: Wikipedia link, photo author and license, "Verified on Wikipedia" badge.
- **F10 – Shortlist review**: step between Swipe and Itinerary. Flow: **Setup → Swipe → Review → Itinerary**.

**Out of scope**: login, bookings, real-time opening hours, public transport routing, multi-city trips, group swiping, dark mode, online deployment, containerization.

## 2. Non-functional requirements

- **Performance** (measured on `next build && next start`): Lighthouse mobile ≥ 90, initial JS < 200 KB gz, CLS < 0.05, tested with 4× CPU throttling and Slow 4G; Leaflet and chat lazy-loaded.
- **Visual quality**: fixed aspect ratios, skeletons, fallbacks for missing images, `100dvh` + safe areas, QA at 320×568, 360×640, 390×844, 768, 1280+.
- **Accessibility**: button/keyboard alternatives to swiping, visible focus, `prefers-reduced-motion`, AA contrast, `aria-live` in the chat.
- **Resilience**: clear errors with retry; state always persisted.
- **Cost**: $0.

### 2.1 Guardrails (deterministic controls only, OWASP Top 10 for LLM Applications 2025)

| Risk                            | Control                                                                                                                            |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| LLM01 Direct prompt injection   | Chat input ≤ 500 chars; heuristics for known patterns → standard refusal and log; tools scoped to the current trip                 |
| LLM01 Indirect prompt injection | Wikipedia content passed as delimited data, never as instructions; the agent cannot fetch arbitrary URLs                           |
| LLM02 Sensitive information     | LangChain PII detectors (redaction before the agent run); no personal data stored; no secrets in prompts                           |
| LLM05 Improper output handling  | Structured outputs validated with Zod; markdown rendered without raw HTML, sanitized; links only to allow-listed domains           |
| LLM06 Excessive agency          | Allow-listed tools with strict schemas; `trip_id` bound server-side; per-turn model/tool call limits; edits versioned and undoable |
| LLM07 System prompt leakage     | No secrets in prompts; standard reply to extraction attempts                                                                       |
| LLM09 Misinformation            | Wikipedia grounding + distance filter, itinerary validator, "verify opening hours" disclaimer                                      |
| LLM10 Unbounded consumption     | Per-IP and per-trip rate limits (SQLite table), global daily LLM call budget, `maxTokens` and timeouts per call                    |
| Transparency and verification   | "AI-generated" badge, free-tier data-training disclaimer; adversarial prompts in evals; guardrail hits tagged in traces            |

## 3. Architecture

```
Browser ──▶ Next.js (local Node process)
             ├─ Server Components: trip, deck and itinerary from SQLite (Drizzle)
             ├─ Server Actions: swipe, undo, review, itinerary quick actions (+ revalidatePath)
             ├─ Route handler /api/chat: streaming LangChain agent
             ├─ LangChain/LangGraph ──▶ OpenRouter :free model
             ├─ Photon, Wikipedia/Wikimedia (cached, §5)
             └─ LangSmith (tracing, optional)
          data/app.db (SQLite, WAL): domain data + checkpointer + caches + rate limits
```

Guiding principle: **the LLM curates and explains; deterministic code guarantees feasibility.** Every route touching the database runs on the Node runtime and calls `connection()` before synchronous queries (otherwise Next.js prerenders them at build time).

### 3.1 Data flow with native Next.js tools

- **Deck**: loaded once by the Server Component; a swipe updates client state immediately (`useOptimistic`) and sends the Server Action in the background; on error, rollback + toast.
- **Review and quick actions**: Server Action → `revalidatePath` + `useOptimistic`.
- **Agent edits**: a `trip-updated` data part in the stream → `router.refresh()`.
- **Chat**: `useChat` (`@ai-sdk/react`) + `@ai-sdk/langchain`.

### 3.2 Model layer (`src/server/ai/models.ts`)

- `getChatModel(role, env)` → `ChatOpenAI` pointed at OpenRouter's OpenAI-compatible API, with per-role temperature/max tokens and retries with backoff on 429/5xx; model configured via env. Callers apply `bindTools` / `withStructuredOutput` on the result. Adding a second provider later only touches this module (`withFallbacks`).
- **M0 spike** (`npm run spike:llm`): chat, tool calling and structured output on the configured model (3 requests).
- Fake mode: `FakeListChatModel` / per-role fixtures.

### 3.3 AI workflows

- **A. Place discovery** (cache-first): the city's pool is already in the DB → deterministic filtering and ranking by interests. Otherwise the LLM generates ~40 tagged attractions → enrichment from Wikipedia → drop unmatched or distant entries → save to the shared city pool. "Load more" generates with an exclusion list.
- **B. Itinerary** (LangGraph subgraph): `prepare` (haversine × 1.3; walking ≤ 2 km at 4.5 km/h, otherwise transit at 20 km/h + 10 min) → `cluster` → `plan` (LLM) → `validate` → on failure back to `plan` with the errors (max 2) → deterministic fallback → saved as a new version.
- **C. Chat agent** (`createAgent` + `SqliteSaver` + PII / call-limit / guardrail middleware): compact trip snapshot injected each turn, truncated history. Tools: `set_trip`, `find_more_places`, `add_place`, `remove_place`, `edit_itinerary(ops[])`, `regenerate_itinerary(instructions)`.

## 4. Data model (Drizzle `sqlite-core`, `src/server/db/schema.ts`)

JSON as `text({ mode: "json" })`, enums as `text({ enum })`, timestamps as `integer({ mode: "timestamp" })`, UUIDs generated in the app.

- `cities`, `places` (unique `(city_id, wiki_title)`), `trips`, `swipes` (PK `(trip_id, place_id)`), `itineraries` (versioned)
- `http_cache` (raw third-party responses with TTL), `llm_cache` (exact-match LLM cache), `rate_limits`
- Checkpointer tables `checkpoints` and `writes` (created by `npm run db:migrate`)

Migrations: `npm run db:generate` + `npm run db:migrate`; `npm run db:studio` to browse. Moving to Postgres later keeps queries nearly identical but requires rewriting the schema with `pg-core`.

## 5. Caching strategy

### 5.1 Third-party APIs

| Strategy                                        | Pros                                         | Cons                                           | Use                                             |
| ----------------------------------------------- | -------------------------------------------- | ---------------------------------------------- | ----------------------------------------------- |
| **SQLite as domain cache** (cities, places)     | Durable, queryable, shared, no extra service | Refresh policy needed (`fetched_at` > 90 days) | ✅ Main layer                                   |
| **`http_cache` table** (raw responses with TTL) | Persistent, inspectable, no extra service    | Small utility + periodic cleanup               | ✅ Photon (30 days), Wikipedia summary (7 days) |
| In-memory LRU                                   | Zero latency                                 | Lost on restart                                | ✅ L1 for autocomplete only                     |
| Browser HTTP cache + debounce                   | Free                                         | Per session                                    | ✅ `Cache-Control` on GETs, 250 ms debounce     |
| Next.js Data Cache                              | Zero code                                    | Semantics changed across versions              | ❌                                              |
| Redis                                           | Native TTLs                                  | Software to install                            | ❌                                              |

### 5.2 Reducing LLM calls (by impact)

1. **Domain-level precomputation**: shared per-city place pool + **seed script** (~25 demo cities).
2. **Deterministic first**: F8 ranking, quick actions, Maps export, validation, fallback.
3. **Exact-match LangChain cache**: `BaseCache` on `llm_cache`, only for the `discovery` and `planner` roles.
4. **Lean chat turns**: injected snapshot, truncated history, short tool confirmations, call limits.
5. **Semantic caching: not recommended** (answers depend on trip state, false hits between similar cities).
6. Provider prompt caching: saves tokens, not requests; keep the prompt prefix stable.

## 6. Server surface

- Route handlers: `GET /api/cities?q=`, `POST /api/chat` (streaming), `GET /api/health`.
- Server Actions: `createTrip`, `recordSwipe`, `undoSwipe`, `loadMorePlaces`, `updateShortlist`, `generateItinerary`, `editItinerary`, `undoItinerary` (Zod + rate limits).

## 7. UI/UX

- **Desktop**: visual area (Setup → Swipe → Review → Itinerary stepper) + chat on the right (~380 px, collapsible); list and map side by side in the itinerary.
- **Mobile**: full-screen visual area, chat in a bottom sheet opened from a FAB, list/map toggle.
- **Swipe deck**: Pointer Events + transforms; only the top 3 cards in the DOM; next 2 images preloaded; 640 px thumbnails.
- **States**: skeletons and streamed progress, empty/error states with retry, "AI is busy" banner when quotas are exhausted.

## 8. Repository layout

```
src/app/                 pages, api/{chat,cities,health}/route.ts
src/components/          setup/, swipe/, review/, itinerary/, map/, chat/, trip/, ui/
src/server/actions/      server actions
src/server/ai/           models.ts, prompts.ts, cache.ts, budget.ts, fake.ts, fake-agent.ts
src/server/agent/        agent.ts, tools.ts, guardrails.ts, checkpointer.ts, snapshot.ts
src/server/itinerary/    cluster.ts, validate.ts, fallback.ts, insert.ts, graph.ts
src/server/places/       discover.ts, wikipedia.ts, photon.ts, http-cache.ts
src/server/limits/       rate limits and their policies
src/server/db/           schema.ts, connection.ts, client.ts
src/lib/                 shared pure code and Zod schemas: geo.ts, ranking.ts, maps-url.ts
drizzle/  data/ (ignored)  scripts/  tests/{unit,integration,components,e2e}  evals/  docs/
```

## 9. Milestones

All milestones are complete. Dates are 2026.

### M0 – Foundations and spikes ✅

Next.js + strict TypeScript, Tailwind, shadcn/ui (Radix, Nova preset), ESLint/Prettier, Vitest,
Playwright (mobile + desktop smoke tests); Drizzle + `better-sqlite3` + first migration; install
verified without `node-gyp`; `SqliteSaver` working; GitHub Actions (lint, format, typecheck, test,
build, e2e, secrets scan); `LLM_MODE`. The live LLM spike passed on `openrouter/free` (chat, tool
calling, structured output).

### M1 – Data and places ✅

Photon, Wikipedia, `http_cache`, `llm_cache`, workflow A, seed script, LangSmith tracing.

### M2 – Setup, swipe, review ✅

F1, F2, F3, F8, F9, F10; offline E2E fixtures (`tests/e2e/seed.ts`).

### M3 – Itinerary and map ✅

geo/cluster/validate/fallback with unit tests, subgraph B, F4, F5, F7.

### M4 – Chat agent ✅

Two-pane layout, streaming, tools, checkpointer, `trip-updated` → `router.refresh()`.

Owner decisions:

- The home chat is stateless (the client sends ≤ 10 turns); its turns are copied into the trip
  that `set_trip` creates.
- Only structural guardrails in M4 (500-char input, 4 model / 3 tool calls per turn, trip bound
  server-side, last 12 messages); PII handling, injection heuristics and rate limits stay in M5.
- Plain-text replies (sanitized markdown in M5).
- `add_place` on an existing itinerary inserts deterministically (cheapest insertion within the
  budget, new version).

### M5 – Hardening ✅

Guardrails, rate limits and budget, accessibility, performance on the production build, visual
QA, LangSmith evals. The Lighthouse mobile ≥ 90 target moved to M7 (measured 2026-11-16 with
simulated 4× CPU / slow 4G: performance ~82 home, ~78 swipe, ~67 review, ~75 itinerary;
accessibility and best practices 100; LCP 2.9–4 s and TBT 0.4–0.8 s driven by hydration JS;
initial JS < 200 KB gz and CLS 0 met).

Owner decisions:

- The whole milestone in one go.
- Defaults: `LLM_DAILY_BUDGET=45` live requests per UTC day, 20 chat turns/h and 10 AI actions/h
  per IP, 40 chat turns/day per trip, all via env. The budget counts provider requests only; the
  fake model is never charged but is still stopped when the budget is used up.
- Sanitized markdown with `react-markdown`; `@axe-core/playwright` for automated a11y checks;
  Lighthouse via `npx` (not a dependency).
- LangSmith evals both live (`npm run evals`) and offline (dataset heuristics in `npm test`).

Implementation notes:

- PII is redacted with LangChain's PII detectors on every incoming message instead of
  `piiMiddleware` (4 instances added 8 graph steps per model call and hit the recursion limit).
- Performance budgets, a11y and 320–1280 px overflow checks are automated E2E specs.
- A second E2E server with a 0 budget covers the "AI is busy" states.

### M6 – Demo polish ✅

README quickstart, architecture diagram, demo GIF, LangSmith screenshots, ADRs.

Owner decisions (2026-11-16):

- The demo is recorded by a Playwright script (`npm run demo:record`: fake LLM, throwaway copy of
  `data/app.db` with real Rome photos) and converted once to GIF with ffmpeg (not a project
  dependency; `docs/media/demo.gif`, ~5 MB).
- Short MADR ADRs in `docs/adr/` (10 records, written retroactively).
- Mermaid diagrams in the README (component flowchart + chat-turn sequence).
- LangSmith screenshots by `npm run docs:langsmith`: the API finds the latest chat turn with
  `add_place`, `itinerary_planner` run and adversarial experiment; missing ones are created with
  live requests only after asking every time; Playwright reuses a saved session
  (`data/langsmith-auth.json`); sidebar cropped, tips and notices hidden.

### M7 – Performance pass ✅ (Swipe exception)

Goal (owner decision, 2026-11-16): reach Lighthouse mobile ≥ 90 on every step without losing
what M5 met (initial JS < 200 KB gz, CLS < 0.05, accessibility 100). Each work item is kept only
if it measurably helps; any new dependency or change to the performance requirements goes to the
owner first.

Measurement protocol: production build, Lighthouse 13.6.0 via `npx` with its default simulated
4× CPU / slow 4G, medians of 5 runs per page (baseline: 3), on a copy of `data/app.db` (real
Commons photos, fake LLM). The machine was not fully idle, so run-to-run spread is about ±5–10
points.

Baseline (performance / TBT / LCP): Setup 91 / 392 ms / 0.8 s, Swipe 66 / 497 ms / 5.8 s,
Review 94 / 278 ms / 0.8 s, Itinerary 88 / 476 ms / 1.0 s; accessibility 100 everywhere, best
practices 77 on Swipe and Review (third-party cookies set by Wikimedia image hosts), CLS 0.

Owner decisions (2026-11-17): lazy-load sonner rather than replace it; only the listed work
items, then stop and report; one commit per kept change; for Swipe, options A (image priorities)
and C (Commons originals), no new dependency.

| #   | Work item                                                                                 | Result                                                                                                                        |
| --- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 1   | Load sonner on the first toast                                                            | **Kept**: ~10 KB less JS on every page, lower script evaluation (e.g. Review 1337 → 750–1016 ms)                              |
| 2   | `experimental.inlineCss`                                                                  | **Dropped**: worse on every page (FCP 0.78 → 1.02 s, TBT up; CSS parsed on the main thread and duplicated in the RSC payload) |
| 3   | `:has()` layout selectors rewritten with child combinators                                | **Dropped**: no change beyond noise                                                                                           |
| 4   | Suspense around client islands                                                            | Not changed: every page already streams its islands inside Suspense                                                           |
| 5   | Trim `lucide-react` on first load                                                         | Not pursued: under 3 KB raw in total                                                                                          |
| 6   | Top card photo `fetchpriority=high`, cards behind `low`, preload after the window load    | **Kept**: Swipe LCP 5.3 → 3.8–4.0 s, performance 67 → 77–79                                                                   |
| 6b  | Also keep the photos of the cards behind out of the DOM until load                        | **Dropped**: LCP unchanged, TBT up                                                                                            |
| 7   | Replace unscaled Commons originals ≥ 500 px wide with their 500 px thumbnail at discovery | **Kept**: Sistine Chapel 601 → 190 KB                                                                                         |

Result: Setup 93, Swipe 77 (LCP 4.0 s, TBT 411 ms), Review 94, Itinerary 88 (80–94 across
sessions); initial JS < 200 KB gz, CLS 0 and accessibility 100 on every page.

Closed by the owner on 2026-11-17 with a documented exception for Swipe: its LCP is the top
card photo, which paints after the React/Next runtime hydrates. Further options, not planned:
smaller card photos, or less framework JS.

## 10. Verification

- **Unit (Vitest)**: geo, clustering, validator, fallback, F8 ranking, Maps URLs, cache keys, guardrail heuristics.
- **Integration** (temporary SQLite file, `LLM_MODE=fake`, Wikipedia and Photon mocked with msw): workflow A cache hit/miss, subgraph B repair loop, "AI is busy" handling on simulated 429, tools bound to the server-side `trip_id`, checkpointer persistence.
- **Component** (Testing Library + happy-dom, Server Actions mocked).
- **E2E (Playwright against `next start`, mobile + desktop, `LLM_MODE=fake`)**: setup → swipe → review → itinerary → chat edit → map and Maps links updated; accessibility, performance budgets, layout overflow and screenshot comparison. Playwright downloads Chromium into the user cache via npm (no system install).
- **Coverage**: 100% of `src/` (statements, branches, functions, lines), enforced in CI and by a Claude Code Stop hook.
- **Live checks** (`LLM_MODE=live`, outside CI): full flow on the configured OpenRouter model.
- **LangSmith evals**: ~10 trips + ~15 adversarial prompts.
- **Lighthouse** (outside CI): mobile on `next start`, 4× CPU / Slow 4G (see M7).

## 11. Risks

| Risk                                                                                                           | Mitigation                                                                                                                                                       |
| -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SQLite write locks under concurrent requests                                                                   | WAL + `busy_timeout`, short transactions; 5 users are well within limits                                                                                         |
| Single provider: OpenRouter free quota (~50 requests/day without a one-off credit purchase) caps the whole app | Caching, seed, deterministic-first design, daily budget with "AI is busy" banner, `LLM_MODE=fake` for development; a second provider can be added in `models.ts` |
| Free model removed or degraded                                                                                 | Model via env, M0 spike to re-validate a replacement                                                                                                             |
| Uneven tool calling across free models                                                                         | Spike before switching models, simple schemas, validated outputs                                                                                                 |
| No live demo                                                                                                   | Demo video + short quickstart                                                                                                                                    |
| Free-tier data used for training                                                                               | No personal data, PII redaction, disclaimer                                                                                                                      |

## Appendix A – LLM comparison

|      | Gemini free                                                                             | Workers AI                       | OpenRouter `:free`                                                    |
| ---- | --------------------------------------------------------------------------------------- | -------------------------------- | --------------------------------------------------------------------- |
| Pros | High quality, reliable tool calling and structured output, native LangChain integration | Low latency on Cloudflare        | One API, many models                                                  |
| Cons | Changing quotas, free-tier data used for training                                       | 10k neurons/day, Cloudflare only | 50 requests/day without credits, unstable models, uneven tool calling |
| Role | Not used for now (candidate second provider)                                            | Excluded                         | **Only provider**                                                     |

A local model (Ollama) was ruled out: on a typical laptop without a dedicated GPU a 3B model generates ~8–14 tokens/s, over a minute per agent turn, with unreliable tool calling.
