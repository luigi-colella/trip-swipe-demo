import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import { AI_BUSY_MESSAGE, AI_PAUSED_MESSAGE } from "@/lib/ai-busy";
import type { AppDatabase } from "@/server/db/connection";
import { addToWindow, DAY_MS, windowCount, windowStart } from "@/server/limits/rate-limits";

/**
 * Global daily LLM budget (LLM10). OpenRouter's free tier allows ~50 requests a day for the
 * whole app, so every request sent to the provider is counted in SQLite, and once the budget
 * is used up no model is called until 00:00 UTC (the UI shows "AI is busy"). Cache hits and
 * deterministic work are free.
 */

const KEY = "llm:daily";

export class LlmBudget {
  constructor(
    private readonly db: AppDatabase,
    readonly limit: number,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Provider requests sent today (UTC). */
  used(): number {
    return windowCount(this.db, KEY, DAY_MS, this.now());
  }

  exhausted(): boolean {
    return this.used() >= this.limit;
  }

  /** When today's budget is renewed. */
  resetsAt(): Date {
    return new Date(windowStart(DAY_MS, this.now()) + DAY_MS);
  }

  /** Counts one request sent to the provider. */
  record(): void {
    addToWindow(this.db, KEY, DAY_MS, this.now());
  }

  /** The provider says its own daily quota is used up: stop calling it today. */
  markExhausted(): void {
    addToWindow(this.db, KEY, DAY_MS, this.now(), { amount: 0, atLeast: this.limit });
  }
}

/** The model was not called (or refused): the budget or the provider's quota is used up. */
export class AiBusyError extends Error {
  constructor(readonly reason: "budget" | "provider") {
    super(reason === "budget" ? AI_PAUSED_MESSAGE : AI_BUSY_MESSAGE);
    this.name = "AiBusyError";
  }
}

const RATE_LIMIT_ERRORS = new Set([
  "RateLimitCapacityError",
  "RateLimitQuotaExhaustedError",
  "InsufficientQuotaError",
]);

/**
 * True for errors meaning "try again later" rather than "broken": the budget guard's
 * AiBusyError and the provider's 429s as LangChain reports them (directly or as a cause).
 */
export function isAiBusyError(err: unknown): boolean {
  for (let e = err, depth = 0; e instanceof Error && depth < 5; e = e.cause, depth++) {
    const fields = e as Error & { status?: unknown; lc_error_code?: unknown };
    if (
      e instanceof AiBusyError ||
      RATE_LIMIT_ERRORS.has(e.name) ||
      fields.status === 429 ||
      fields.lc_error_code === "MODEL_RATE_LIMIT"
    ) {
      return true;
    }
  }
  return false;
}

/** What to tell the user after an AiBusy error: paused for the day, or busy for a minute. */
export function aiBusyText(budget?: LlmBudget): string {
  return budget?.exhausted() ? AI_PAUSED_MESSAGE : AI_BUSY_MESSAGE;
}

/**
 * Stops a model call before it starts once the budget is used up. Runs for every chat model
 * call, fake ones included, so the "AI is busy" flows can be tested offline.
 */
export class BudgetGuard extends BaseCallbackHandler {
  name = "llm_budget_guard";

  constructor(private readonly budget: LlmBudget) {
    // raiseError: the error aborts the call instead of being logged (it also awaits the check).
    super({ raiseError: true });
  }

  override handleChatModelStart(): void {
    if (this.budget.exhausted()) throw new AiBusyError("budget");
  }
}

/** Short, safe description of a thrown fetch error: name and (bounded) message only. */
function describeError(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}`.slice(0, 200) : "unknown error";
}

/**
 * fetch for the provider client: counts every request (retries included, they use quota too),
 * notices when the provider's own daily quota is used up, and logs failed requests so failures
 * and the SDK's retries are visible on the server. Logs never include headers, bodies or URLs.
 */
export function budgetedFetch(budget: LlmBudget): typeof fetch {
  return async (input, init) => {
    budget.record();
    const started = Date.now();
    const elapsed = () => `${Date.now() - started}ms`;
    let response: Response;
    try {
      response = await fetch(input, init);
    } catch (err) {
      // The SDK aborts its own signal both on timeout and when the caller cancels: not
      // necessarily a failure, but the duration tells a timeout apart.
      if (init?.signal?.aborted) {
        console.info(`LLM request aborted after ${elapsed()} (timeout or cancelled)`);
      } else {
        console.warn(`LLM request failed: ${describeError(err)} after ${elapsed()}`);
      }
      throw err;
    }
    const duration = elapsed();
    if (response.status === 429) {
      // OpenRouter: "Rate limit exceeded: free-models-per-day…" (the per-minute limit says
      // "per-min" and only needs a short wait).
      const daily = /per-day/i.test(await response.clone().text());
      if (daily) budget.markExhausted();
      console.warn(
        `LLM request failed: 429 (${daily ? "daily quota" : "rate limit"}) after ${duration}`,
      );
    } else if (!response.ok) {
      console.warn(`LLM request failed: ${response.status} after ${duration}`);
    }
    return response;
  };
}
