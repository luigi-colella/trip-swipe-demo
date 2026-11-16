# 0002 – SQLite with `better-sqlite3` and Drizzle for all state

- Status: Accepted
- Date: 2026-11-15

## Context

The app stores trips, swipes, itinerary versions, place pools, third-party caches, rate
limits and the agent's conversation memory. Under [0001](0001-run-locally-only.md) there can
be no database server, and installs must not need build tools.

## Decision

One SQLite file (`data/app.db`) holds everything, accessed through Drizzle ORM with the
`better-sqlite3` driver (prebuilt binaries, Windows x64 included). The LangGraph checkpointer
is the official `@langchain/langgraph-checkpoint-sqlite` (`SqliteSaver`), which uses the same
driver. The connection uses WAL mode and `busy_timeout` and is a singleton per Next.js
process.

## Alternatives

| Option                  | Why not                                                                                                                 |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `node:sqlite` (Node 24) | Nothing to install, but Drizzle supports it only in the 1.0 beta and there is no official checkpointer. Kept as plan B. |
| `@libsql/client`        | Stable in Drizzle, but only a community port of the checkpointer.                                                       |
| Postgres                | A server to install and run.                                                                                            |

## Consequences

- One file to back up, inspect (`npm run db:studio`) or delete to start over.
- `better-sqlite3` is synchronous: with Cache Components, Next.js would run DB reads at
  build time, so Server Components and route handlers call `await connection()` first.
- WAL + `busy_timeout` and short transactions are plenty for ~5 users.
- Moving to Postgres later keeps queries nearly identical but means rewriting the schema
  with `pg-core` and switching the checkpointer.
