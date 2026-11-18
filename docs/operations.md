# Operations

How to run, seed, evaluate and document TripSwipe AI locally. For what the app does and how it
is built, see the [README](../README.md).

## Scripts

| Command                                            | Purpose                                                                                                                                             |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev` / `build` / `start`                  | Next.js dev server, production build, production server                                                                                             |
| `npm test`                                         | Vitest unit, integration and component tests (offline, `LLM_MODE=fake`)                                                                             |
| `npm run test:coverage`                            | The same tests with coverage; fails below 100% of `src/`                                                                                            |
| `npm run test:e2e`                                 | Playwright flows, accessibility, performance and screenshots, mobile + desktop (after `npm run build`; first run `npx playwright install chromium`) |
| `npm run test:e2e:update-screenshots`              | Regenerates the screenshot references (Windows only for now) after an intended UI change                                                            |
| `npm run lint` / `typecheck` / `format`            | Code quality                                                                                                                                        |
| `npm run db:generate` / `db:migrate` / `db:studio` | Drizzle migrations and DB browser                                                                                                                   |
| `npm run db:seed`                                  | Discovers and caches the places of ~25 demo cities; resumable, `-- --cities Rome,Paris` for a subset                                                |
| `npm run spike:llm`                                | Checks chat, tool calling and structured output on the configured OpenRouter model (needs API key)                                                  |
| `npm run evals`                                    | LangSmith evals of the planner and the chat agent; `-- --suite trips`, `-- --dry-run` (see "Running the evals")                                     |
| `npm run demo:record`                              | Records the demo video in fake mode on a copy of the local database (after `npm run build`; see "Recording the demo")                               |
| `npm run docs:langsmith`                           | Updates the LangSmith screenshots in `docs/media/` (see "LangSmith screenshots")                                                                    |

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

## Running the evals

The suites and their scores are described in the [README](../README.md#evals-and-tracing-with-langsmith).
Results go to LangSmith as experiments (datasets are created on first use; needs
`LANGSMITH_API_KEY`). `--suite trips|adversarial` runs one suite, `--dry-run` prints the
scores without uploading. In `LLM_MODE=live` a full run can take ~20–60 OpenRouter requests,
so run one suite per day; `LLM_MODE=fake --dry-run` checks the setup offline. The datasets
are also checked offline by `npm test` (what the heuristics must and must not catch).

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

## LangSmith screenshots

`npm run docs:langsmith` refreshes the LangSmith screenshots in `docs/media/`: the latest
chat turn that calls `add_place`, the latest `itinerary_planner` graph and the latest
adversarial eval experiment, found through the API (`LANGSMITH_API_KEY`, `LANGSMITH_AGENT_*`).

- **Missing data:** when LangSmith has nothing to show for one of them, the script offers to
  create it with the live model and asks every time, showing the cost (chat turn ~2
  requests, plan 1–3, adversarial evals ~15–30) and the requests already used today. Run it
  in an interactive terminal; elsewhere it never spends quota. Needs Rome seeded.
- **Sign-in:** the LangSmith web app needs a browser session, not the API key. The first
  time, or when the saved session has expired, a Chromium window opens: sign in there (email
  or GitHub; Google may refuse automated browsers) and the script continues by itself. The
  session is kept in `data/langsmith-auth.json` (gitignored): treat it like a password.
- The images leave out the sidebar (account and workspace names), product tips and account
  notices, and mask email addresses; still check them before committing.

## Recording the demo

`npm run demo:record` (after `npm run build`) plays the flow shown at the top of the README with Playwright
and records it to `test-results/demo/record-demo/video.webm`. It runs a production server on
port 3200 in `LLM_MODE=fake` against `data/demo.db`, a throwaway copy of `data/app.db`, so it
costs no quota and leaves your trips alone. It needs Rome's real place pool (photos included):
seed it once with `npm run db:seed -- --cities Rome` (1 live request). Photos and map tiles
come from the network. The script is in `scripts/demo/`; it is not part of the test suites.

To refresh `docs/media/demo.gif`, convert the video with any tool; with
[ffmpeg](https://ffmpeg.org) (not needed by the project):

```bash
ffmpeg -ss 1 -i test-results/demo/record-demo/video.webm -vf "fps=8,scale=800:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=64:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle" -loop 0 docs/media/demo.gif
```

`-ss 1` skips the blank frames recorded while the first page loads, so the GIF (and its
preview) starts on the setup screen; if a new recording still starts blank, raise it. These
settings keep the GIF under 5 MB.
