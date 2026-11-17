# 0001 – Run locally only, with nothing to install besides Node.js

- Status: Accepted
- Date: 2026-11-15

## Context

TripSwipe AI is a demo of a full-stack web app with generative AI. It serves at most ~5
concurrent users, must cost $0, and should be easy to try: clone, `npm install`, run.

## Decision

The first release runs only on the developer's machine: `npm run dev` for development,
`npm run build && npm start` for demos. Nothing has to be installed besides Node.js and npm
packages: no Docker, no database server, no packages that need native compilation.

## Alternatives

- **Free hosting (Vercel, Fly.io, Render…)**: a public live demo, but serverless runtimes do
  not keep a SQLite file, free tiers change often, and a public URL exposes the tiny free LLM
  quota to anyone.
- **Docker Compose**: reproducible, but one more thing to install and slower to start on
  Windows and macOS.

## Consequences

- Every component must work in a single Node.js process with a local file database
  ([0002](0002-sqlite-with-better-sqlite3.md)).
- There is no live demo: the README carries a demo GIF and a short quickstart instead.
- Online deployment and containerization are out of scope; moving later mostly means
  replacing SQLite (see [0002](0002-sqlite-with-better-sqlite3.md)).
