# 0004 – LangChain.js v1 and LangGraph.js for the AI workflows

- Status: Accepted
- Date: 2026-11-15

## Context

The project showcases a production-style generative AI stack in TypeScript: an agent with
tools and memory, a multi-step planning workflow with a repair loop, tracing and evals.

## Decision

- **Chat agent**: LangChain v1 `createAgent` with six allow-listed tools, the SQLite
  checkpointer (`thread_id` = trip id) and call-limit middleware.
- **Itinerary planning**: a LangGraph subgraph `prepare → cluster → plan → validate`, back to
  `plan` with the validation errors at most twice, then a deterministic fallback.
- **Place discovery**: a single structured-output call, cached.
- **Observability**: LangSmith (free Developer plan, optional) for traces and evals.
- **Streaming to the browser**: the AI SDK's `useChat` with the `@ai-sdk/langchain` adapter.

## Alternatives

- **Hand-written calls to the OpenAI-compatible API**: fewer dependencies, but tool loops,
  memory, retries, structured output and tracing would all be rebuilt by hand.
- **Vercel AI SDK only**: excellent streaming, but no graph workflows or checkpointer, and it
  would not showcase the LangChain ecosystem, a goal of the project.

## Consequences

- The agent's memory lives in the same SQLite file as the domain data.
- Graph steps count against LangGraph's recursion limit, which ruled out stacking middleware
  for PII ([0010](0010-pii-detectors-not-middleware.md)).
- Fake models plug into the same interfaces ([0008](0008-offline-fake-llm-mode.md)).
