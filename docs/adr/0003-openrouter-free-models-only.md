# 0003 – OpenRouter free models as the only LLM provider

- Status: Accepted
- Date: 2026-11-15

## Context

The app must cost $0 ([0001](0001-run-locally-only.md)) yet needs chat, tool calling and
structured output. Free tiers differ in quality, quotas and terms.

## Decision

Use only OpenRouter `:free` models through its OpenAI-compatible API (`ChatOpenAI` pointed at
OpenRouter), with the model chosen via env (default: the `openrouter/free` router). All models
come from `getChatModel(role, env)` in `src/server/ai/models.ts`, which sets per-role
temperature, `maxTokens`, timeouts and retries; no other module creates provider clients.

## Alternatives

| Option                | Pros                                                    | Cons                                                                                                                               |
| --------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Gemini free tier      | Good quality and tool calling, native LangChain package | Quotas change often; free-tier data used for training. Candidate second provider.                                                  |
| Cloudflare Workers AI | Low latency                                             | 10k neurons/day, ties the app to Cloudflare                                                                                        |
| Local model (Ollama)  | No quota                                                | ~8–14 tokens/s for a 3B model on a laptop without GPU: over a minute per agent turn, unreliable tool calling, something to install |

## Consequences

- About 50 requests per day without a one-off credit purchase: the whole design saves calls
  ([0005](0005-deterministic-first.md), [0007](0007-caching-in-sqlite.md)) and a daily budget
  stops AI features cleanly when it runs out
  ([0009](0009-deterministic-guardrails-and-budget.md)).
- Free models come and go and their tool calling is uneven: `npm run spike:llm` re-checks a
  model before switching, schemas stay simple and outputs are validated with Zod.
- Free models may train on prompts: no personal data is stored, PII is redacted
  ([0010](0010-pii-detectors-not-middleware.md)) and the chat shows a disclaimer.
- A second provider later only touches `models.ts` (e.g. `withFallbacks`).
