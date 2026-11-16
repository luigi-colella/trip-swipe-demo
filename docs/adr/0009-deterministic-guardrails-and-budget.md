# 0009 – Deterministic guardrails, rate limits and a daily LLM budget

- Status: Accepted
- Date: 2026-11-16

## Context

The chat agent can change trips, and every request spends the small free quota. The OWASP
Top 10 for LLM Applications (2025) lists the risks: prompt injection, sensitive data,
improper output handling, excessive agency, prompt leakage, misinformation and unbounded
consumption.

## Decision

Only deterministic controls, no LLM-as-a-judge:

- **Structural limits**: chat input ≤ 500 characters; at most 4 model and 3 tool calls per
  turn; allow-listed tools with strict schemas, bound server-side to the open trip (ids from
  the model are never trusted, places are referred to by name); edits are undoable versions.
- **Heuristics** for known injection and extraction patterns: a standard refusal without
  calling the model, logged and tagged `guardrail:<kind>` in traces.
- **Data, not instructions**: Wikipedia text is passed as delimited data; the agent cannot
  fetch URLs.
- **Output handling**: Zod-validated structured outputs; replies rendered as sanitized
  markdown (no raw HTML or images, links only to allow-listed domains).
- **Consumption**: a daily budget of live requests counted in SQLite (`LLM_DAILY_BUDGET`,
  default 45 per UTC day), per-IP and per-trip rate limits, `maxTokens` and timeouts per call.
  When the budget is used up an "AI is busy" banner explains it and non-AI features keep
  working.

## Alternatives

- **An LLM classifier for prompt attacks**: better recall, but doubles the requests per turn
  on a ~50/day quota, and is itself injectable.
- **Provider-side limits only**: OpenRouter's own daily limit would surface as opaque errors
  and could not keep the app's users from using up the quota needed by seeding and evals.

## Consequences

- The heuristics favour precision and will miss creative attacks; the structural limits are
  the real protection. LangSmith evals include ~15 adversarial prompts.
- All limits are configurable via env and covered by tests; a second E2E server with a 0
  budget tests the "AI is busy" states.
