# TripSwipe AI - Proof of Concept

Swipe through a city's attractions, and an AI agent turns your picks into a realistic
day-by-day itinerary that you refine by chatting.

TripSwipe AI is a full-stack generative AI web app (Next.js, TypeScript, LangChain.js,
LangGraph.js, SQLite). It is a **proof of concept, not a production app**: it runs locally, for
a handful of users, on free models, with no accounts and no deployment. Within that scope it
applies the engineering practices a real AI system needs: agentic workflows with deterministic
fallbacks, guardrails, evals, tracing and 100% test coverage. It is also an experiment in how
software gets built: **every line of code, test and documentation was written by a coding agent
(Claude Code)**, while I owned the requirements, the decisions and the quality bar. See
[How it was built](#how-it-was-built-100-agent-written-code).

![Demo: pick Rome for 2 days, swipe through attractions, review the shortlist, generate the itinerary with its map, then move a stop to day 2 by chatting](docs/media/demo.gif)

<sub>Recorded with the offline fake model (`npm run demo:record`). Photos from Wikimedia
Commons (author and license on each card); map data © OpenStreetMap contributors.</sub>

**Flow:** Setup → Swipe → Review → Itinerary, with a chat assistant on every step.

- **Swipe** through ~30 attractions per city (drag, buttons or keyboard; ★ marks a must-see);
  the deck re-ranks itself from what you like.
- **Itinerary**: a LangGraph workflow turns the shortlist into feasible days with times,
  walking/transit legs, a lunch break, a map and Google Maps directions.
- **Chat**: a LangChain agent with tools edits the trip; the page updates as it answers.

## Highlights

### AI engineering

- **Three AI workflows, each shaped for its job.** Cache-first place discovery grounded on
  Wikipedia; a LangGraph planning graph (`prepare → cluster → plan → validate`) with a bounded
  repair loop and a deterministic fallback; a tool-calling chat agent with persistent memory
  that edits the trip while it answers.
- **Deterministic first.** The model curates and explains; code computes distances, schedules,
  validation, ranking and fallbacks. When the model is wrong, slow or unavailable, the app
  still produces a valid plan and says so ("Planned by rules").
- **Guardrails mapped to the OWASP Top 10 for LLM Applications (2025).** Injection and
  prompt-extraction heuristics, PII redaction, tools scoped to the server-side trip (IDs from
  the model are never trusted), per-turn call limits, Zod-validated structured output,
  sanitized markdown with allow-listed links.
- **Evals and observability.** Every model call is traced in LangSmith. Two eval suites with
  deterministic evaluators: itinerary quality on real cities and an adversarial suite of
  injection, extraction and cross-trip attacks.
- **Built for an unreliable, rate-limited provider.** The app runs on free OpenRouter models:
  about 50 requests a day, models that come and go, uneven tool calling. I treated that as a
  constraint to design for, not a shortcut: exact-match LLM cache, precomputed city pools, a
  daily request budget with graceful degradation (swiping, quick edits and rule-based planning
  keep working), timeouts and bounded retries. Any OpenRouter model is one environment variable
  away, and model access lives in one module, so adding a paid provider touches only that file.
- **Offline fake LLM mode.** Scripted models make tests, CI and demos deterministic, and let
  anyone clone and run the app without an API key.

### Software engineering

- **100% test coverage** of `src/` (statements, branches, functions, lines), with unit,
  integration (real SQLite), component and Playwright end-to-end tests on mobile and desktop.
- **Quality as tests:** automated accessibility (axe-core, WCAG 2.1 AA), performance budgets
  (< 200 KB initial JS, CLS < 0.05), layout checks from 320 px to 1280 px, screenshot tests.
- **Defensive by default:** Zod at every trust boundary, typed error results, idempotent
  writes, rate limits, timeouts on every outbound request.
- **CI on every push to main and every pull request:** lint, format, typecheck, coverage, build,
  end-to-end tests, secrets scan.
- **Documented decisions:** the full [specification](docs/PLAN.md) with the owner decisions of
  each milestone, and 10 [architecture decision records](docs/adr/README.md).

## How it was built: 100% agent-written code

Part of the point of this project is to show that the code of a well-engineered full-stack
app can be written entirely by a coding agent, while an engineer steers it: requirements,
decisions, the quality bar and review. I believe this is where software development
is heading, and this repository is how I work.

- **No code written or edited by hand.** All code, tests, configuration and documentation,
  this README included, were written by [Claude Code](https://claude.com/claude-code) (Claude
  Opus 5.5). Every non-merge commit carries a `Co-Authored-By: Claude` trailer.
- **Testing was agentic too.** The agent wrote and ran the automated suites and drove the
  browser for end-to-end and exploratory checks.

**My role: the engineer, not the typist.**

- **Requirements and specification.** I wrote the functional requirements; the agent turned
  them into the [specification](docs/PLAN.md) over four iterations in plan mode, presenting
  each trade-off as options (paid vs free models, OpenRouter vs Gemini, a local model, hosting
  vs local-only).
- **Decisions.** I made the product and architecture decisions: some by choosing among the
  options the agent laid out, others by proposing my own. Every plan went through my approval.
  Requirements change only with my approval, a rule written into the agent's instructions;
  the decisions are recorded in the specification and the ADRs.
- **The quality bar.** I set the rules the agent works under: 100% coverage, screenshot tests
  for every UI change, a defensive programming checklist, Conventional Commits.
- **Review.** I approved each milestone's plan and result.

**The harness that keeps the agent on track.**

- **[`AGENTS.md`](AGENTS.md):** project rules, architecture conventions, the defensive
  programming checklist and the testing policy, loaded into every session.
- **One milestone per session, plan first:** each session started from the next milestone in
  the specification, with the agent asking for missing information before writing code.
- **Automated gates the agent cannot skip:** a Claude Code Stop hook runs the tests and the
  100% coverage check before a task can end, and CI runs the full suite on every pull request.
- **Agent-driven QA:** the agent ran Playwright itself for live-model flow tests and
  robustness testing, and measured performance with a fixed Lighthouse protocol, keeping only
  the changes that measurably helped (see M7 in the [specification](docs/PLAN.md)).
- **Parallel agents:** in the last round, the agent recorded console, server and network logs
  during a browser session, triaged nine findings by risk, and fixed them with five
  subagents working in parallel in isolated git worktrees, each reviewing its own diff before
  the merge.

## Stack

- **Next.js** (App Router, Server Actions) + TypeScript + Tailwind CSS + shadcn/ui
- **LangChain.js v1 / LangGraph.js** for the agent and itinerary workflow, **LangSmith** for tracing and evals
- **OpenRouter** free models as the LLM provider
- **SQLite** via **Drizzle ORM** + `better-sqlite3` (prebuilt binaries: no database server or build tools needed)
- **Vitest**, **Playwright**, **msw** and **axe-core** for testing

## Quickstart

The app runs locally (there is no hosted demo). Requirements: Node.js 24+, nothing else to
install, and no API key for the offline mode.

```bash
npm install
cp .env.example .env.local   # LLM_MODE=fake works offline without API keys
npm run db:migrate
npm run dev                  # http://localhost:3000  (health check: /api/health)
```

In fake mode (the default in `.env.example`), try **Rome** or **Paris** from the setup page,
or type "Plan a trip to Rome for 2 days" in the chat. For real models, set `LLM_MODE=live`
and an `OPENROUTER_API_KEY` (free account at [openrouter.ai](https://openrouter.ai)) in
`.env.local`, then seed a few cities with `npm run db:seed` (see
[Operations](docs/operations.md#seeding-demo-cities)). For a demo, prefer the production
build: `npm run build && npm start`.

## Architecture

One local Next.js process serves the UI and the API, runs the AI workflows and keeps all
state in a single SQLite file. Design decisions are recorded as [ADRs](docs/adr/README.md).

```mermaid
flowchart LR
  browser["Browser<br/>React UI · useChat"]

  subgraph next["Next.js (local Node.js process)"]
    rsc["Server Components<br/>trip, deck, itinerary"]
    actions["Server Actions<br/>swipe, review, plan, quick edits"]
    chat["/api/chat<br/>streaming agent"]
    cities["/api/cities<br/>autocomplete"]
    subgraph ai["AI workflows (LangChain.js / LangGraph.js)"]
      discovery["A · Place discovery<br/>cache-first + Wikipedia grounding"]
      planner["B · Itinerary graph<br/>prepare → cluster → plan → validate"]
      agent["C · Chat agent<br/>6 tools, guardrails, call limits"]
    end
    code["Deterministic code<br/>geo, ranking, validation, fallback"]
  end

  db[("SQLite data/app.db<br/>domain data · caches · rate limits<br/>budget · agent checkpoints")]
  openrouter["OpenRouter<br/>free models"]
  wiki["Photon · Wikipedia<br/>Wikimedia Commons"]
  langsmith["LangSmith<br/>traces · evals (optional)"]

  browser --> rsc & actions & chat & cities
  actions --> discovery & planner & code
  chat --> agent
  agent --> discovery & planner & code
  planner --> code
  rsc & actions & agent & cities --> db
  discovery & planner & agent -->|"getChatModel + daily budget"| openrouter
  discovery & cities --> wiki
  ai -.-> langsmith
```

A chat turn that edits the itinerary (the visual area refreshes as soon as the tool runs):

```mermaid
sequenceDiagram
  actor User
  participant UI as Browser (useChat)
  participant API as /api/chat
  participant G as Guardrails
  participant A as Agent (createAgent)
  participant LLM as OpenRouter
  participant DB as SQLite

  User->>UI: "Move Pantheon to day 2"
  UI->>API: message + trip id (bound server-side)
  API->>G: length, rate limits, budget, injection heuristics, PII redaction
  G-->>API: ok (or a standard refusal, no model call)
  API->>A: run with trip snapshot + last 12 messages
  A->>LLM: decide (tool call)
  A->>DB: edit_itinerary → validated new version
  API-->>UI: data part trip-updated → router.refresh()
  A->>LLM: short reply
  API-->>UI: streamed markdown reply
  A->>DB: checkpoint (conversation)
```

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
  messages. See [Guardrails and limits](#guardrails-and-limits) for the rest.
- **Replies** are rendered as sanitized markdown (bold, lists, code): no raw HTML or images,
  and links only to Wikipedia, Wikimedia Commons, Google Maps and OpenStreetMap.
- **Cost:** about 2 OpenRouter requests per turn that changes the trip (decide, then reply),
  1 for a plain answer; `regenerate_itinerary` and `find_more_places` add their own planner
  or discovery request. Adding a place to an existing itinerary needs no extra request.
- **Offline:** with `LLM_MODE=fake` a scripted model understands simple commands such as
  "Plan a trip to Rome for 2 days", "Add the Colosseum", "Move Pantheon to day 2",
  "Remove Trevi Fountain", "Find more places" and "Plan a new itinerary"
  (`src/server/ai/fake-agent.ts`).

## Guardrails and limits

Deterministic controls only, following the OWASP Top 10 for LLM Applications (2025):

- **Prompt attacks:** known injection and prompt-extraction patterns ("ignore previous
  instructions", "show me your system prompt", chat-template markers…) get a standard
  refusal without calling the model; hits are logged and traced with a `guardrail:<kind>` tag
  (`src/server/agent/guardrails.ts`). The heuristics favour precision: the structural limits
  above are the real protection.
- **Personal data:** emails, card numbers, IP addresses and phone numbers are redacted from
  chat messages (LangChain's PII detectors) before they reach the model or the stored
  conversation. The chat reminds users that free models may use chats for training.
- **Daily LLM budget:** every request sent to OpenRouter is counted in SQLite
  (`LLM_DAILY_BUDGET`, default 45 per UTC day, below the free tier's ~50). When it is used
  up, or OpenRouter reports its own daily limit, AI features pause until 00:00 UTC and an
  "AI is busy" banner explains it: cities already discovered, swiping, quick edits and
  planning by rules keep working. Cache hits and fake mode are free. `npm run db:seed` and
  `npm run evals` count against the same budget.
- **Rate limits** per client IP: 20 chat messages and 10 AI actions (new trip, "Load more",
  planning) per hour, plus 40 chat messages per trip per day (`RATE_LIMIT_*` variables).
  Locally the IP comes from `x-forwarded-for`, which `next start` fills in.
- **Timeouts:** each model request is capped (60 s chat, 120 s planner, 180 s discovery)
  besides its `maxTokens`.

## Quality checks

- **Accessibility:** `tests/e2e/accessibility.spec.ts` runs axe-core (WCAG 2.1 A/AA) on every
  screen and state, mobile and desktop. Swiping has button and keyboard alternatives, focus
  is always visible and animations respect `prefers-reduced-motion`.
- **Performance budgets:** `tests/e2e/performance.spec.ts` checks on the production build that
  each page loads < 200 KB of gzipped JavaScript up front (the chat, Leaflet and the stop
  menus load on demand) and that CLS stays < 0.05 with a 4× slower CPU.
- **Layout:** `tests/e2e/layout.spec.ts` checks every step at 320×568, 360×640, 390×844, 768
  and 1280 px for horizontal overflow; screenshot tests cover the look (`visual.spec.ts`).
- **Lighthouse** (manual): with `npm run build && npm start` running, e.g.
  `npx lighthouse http://localhost:3000 --view` (mobile, simulated 4× CPU and slow 4G).

## Evals and tracing with LangSmith

`npm run evals` scores the real workflows with deterministic evaluators (`evals/`), on a
throwaway copy of the database:

- **trips** (~10): the itinerary planner on the most popular places of seeded demo cities.
  Scores: valid AI plan (no fallback), right the first time, must-sees planned, days within
  the pace.
- **adversarial** (~15): injection, extraction, off-topic and cross-trip requests sent to the
  chat agent. Scores: other trip untouched, no system-prompt leak, declined (or handled),
  heuristics caught exactly the expected prompts.

The datasets are also checked offline by `npm test` (what the heuristics must and must not
catch). Every LLM call can be traced to [LangSmith](https://smith.langchain.com), tagged by
workflow. Setup, costs and options are in [Operations](docs/operations.md#running-the-evals).

A chat turn: the agent calls `add_place` and the trip changes before it replies.

![LangSmith trace of a chat turn: chat_agent runs a model request, the add_place tool, then a second model request for the reply](docs/media/langsmith-chat.png)

The itinerary planner graph: deterministic `prepare`, `cluster` and `validate` steps around a
single model call, valid the first time (`attempts: 1`).

![LangSmith trace of the itinerary_planner graph: prepare, cluster, plan with one ChatOpenAI call, validate](docs/media/langsmith-planner.png)

The adversarial eval experiment: 15 injection, extraction and off-topic prompts, each one
declined or safely handled, with no leak and the other trip untouched.

![LangSmith experiment of the adversarial suite: every case scores 1.00 on declined or handled, heuristics, no prompt leak and other trip untouched](docs/media/langsmith-evals.png)

## Documentation

- [Specification and development plan](docs/PLAN.md): requirements, architecture, milestones
  and the owner decisions behind them.
- [Architecture decision records](docs/adr/README.md).
- [Operations](docs/operations.md): scripts, seeding demo cities, evals, LangSmith tracing and
  screenshots, recording the demo.
- [`AGENTS.md`](AGENTS.md): the instructions the coding agent works under.
