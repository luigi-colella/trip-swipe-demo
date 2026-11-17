# Architecture decision records

Short records of the decisions that shape TripSwipe AI, in a lightweight
[MADR](https://adr.github.io/madr/) format: context, decision, alternatives, consequences.
They were written down after the fact, at the end of the first release (M6), from the
project's planning notes. A decision that changes gets a new record that supersedes the old
one; records are not rewritten.

| #                                                   | Decision                                                      | Status   |
| --------------------------------------------------- | ------------------------------------------------------------- | -------- |
| [0001](0001-run-locally-only.md)                    | Run locally only, with nothing to install besides Node.js     | Accepted |
| [0002](0002-sqlite-with-better-sqlite3.md)          | SQLite with `better-sqlite3` and Drizzle for all state        | Accepted |
| [0003](0003-openrouter-free-models-only.md)         | OpenRouter free models as the only LLM provider               | Accepted |
| [0004](0004-langchain-and-langgraph.md)             | LangChain.js v1 and LangGraph.js for the AI workflows         | Accepted |
| [0005](0005-deterministic-first.md)                 | Deterministic first: the LLM curates, code computes           | Accepted |
| [0006](0006-native-nextjs-data-flow.md)             | Native Next.js data flow, no client data library              | Accepted |
| [0007](0007-caching-in-sqlite.md)                   | Cache in SQLite; exact-match LLM cache, no semantic cache     | Accepted |
| [0008](0008-offline-fake-llm-mode.md)               | An offline fake LLM mode for tests and development            | Accepted |
| [0009](0009-deterministic-guardrails-and-budget.md) | Deterministic guardrails, rate limits and a daily LLM budget  | Accepted |
| [0010](0010-pii-detectors-not-middleware.md)        | PII redaction with LangChain's detectors, not `piiMiddleware` | Accepted |
