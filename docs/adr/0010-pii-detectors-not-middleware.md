# 0010 – PII redaction with LangChain's detectors, not `piiMiddleware`

- Status: Accepted
- Date: 2026-11-16

## Context

Free models may use prompts for training ([0003](0003-openrouter-free-models-only.md)), so
emails, card numbers, IP addresses and phone numbers must not reach the model or the stored
conversation. LangChain v1 offers `piiMiddleware` for `createAgent`, one instance per PII
type.

## Decision

Redact every incoming chat message before the agent runs, calling LangChain's PII detectors
and redaction strategies (`resolveRedactionRule`, `applyStrategy`) directly in
`src/server/agent/guardrails.ts`, instead of adding `piiMiddleware` to the agent.

## Alternatives

- **`piiMiddleware`** (the documented way): four instances added eight graph steps per model
  call, and agent turns hit LangGraph's recursion limit. Rejected after trying it.
- **Hand-written regexes**: no dependency on LangChain internals, but duplicates maintained
  detectors.

## Consequences

- Same detectors as the middleware, no extra graph steps, and the stored conversation never
  contains the original values.
- Only user messages are redacted; tool results come from the app's own data, which holds no
  personal data.
- If a later LangChain release makes the middleware cheaper, this can be revisited with a new
  record.
