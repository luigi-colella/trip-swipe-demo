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
npm run dev                  # http://localhost:3000  (health check: /api/health)
```

## Scripts

| Command                                            | Purpose                                                                                            |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `npm run dev` / `build` / `start`                  | Next.js dev server, production build, production server                                            |
| `npm test`                                         | Vitest unit + integration tests (offline, `LLM_MODE=fake`)                                         |
| `npm run lint` / `typecheck` / `format`            | Code quality                                                                                       |
| `npm run db:generate` / `db:migrate` / `db:studio` | Drizzle migrations and DB browser                                                                  |
| `npm run spike:llm`                                | Checks chat, tool calling and structured output on the configured OpenRouter model (needs API key) |
