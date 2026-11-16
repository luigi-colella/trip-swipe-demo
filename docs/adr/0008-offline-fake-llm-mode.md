# 0008 – An offline fake LLM mode for tests and development

- Status: Accepted
- Date: 2026-11-15

## Context

Tests and UI work would burn the free quota in minutes, and live models are not
deterministic, so tests against them would be flaky.

## Decision

`LLM_MODE=fake` replaces every model with an offline, deterministic one (LangChain fake
models with per-role fixtures): discovery fixtures for Rome and Paris, a planner that accepts
the deterministic draft, and a scripted chat agent that understands simple commands
("Add the Colosseum", "Move Pantheon to day 2"…). Unit, integration, component and E2E tests
always run in fake mode; third-party HTTP is mocked with msw and fails on unhandled requests.
`LLM_MODE=live` is used for manual checks, `npm run db:seed`, `npm run spike:llm` and
`npm run evals`.

## Alternatives

- **Record/replay of live responses**: realistic, but recordings go stale with every prompt
  change and still need a live run to create.
- **Mocking at the HTTP level**: tests the provider adapter too, but couples tests to the
  wire format of one provider.

## Consequences

- CI and the whole test suite are offline and free; the demo GIF is recorded in fake mode.
- Fake mode goes through the same code paths, including the daily budget (it is never
  charged, but it is stopped when the budget is used up) and tracing.
- Live behaviour is covered by the spike, manual checks and LangSmith evals instead of tests.
