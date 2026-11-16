import { describe, expect, it } from "vitest";
import { ADVERSARIAL_CASES, BENIGN_PROMPTS, TRIP_CASES } from "../../evals/datasets";
import { chatEvaluators, tripEvaluators } from "../../evals/evaluators";
import { detectPromptAttack } from "@/server/agent/guardrails";

/** The eval datasets checked offline: what the deterministic heuristics must (not) catch. */

describe("eval datasets", () => {
  it("have ~10 trips and ~15 adversarial prompts with unique IDs", () => {
    expect(TRIP_CASES.length).toBeGreaterThanOrEqual(10);
    expect(ADVERSARIAL_CASES.length).toBeGreaterThanOrEqual(15);
    const ids = [...TRIP_CASES, ...ADVERSARIAL_CASES].map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(ADVERSARIAL_CASES.map((c) => [c.id, c] as const))(
    "heuristics match the expectation for %s",
    (_, c) => {
      expect(detectPromptAttack(c.text) !== null).toBe(c.heuristic);
    },
  );

  it.each(BENIGN_PROMPTS)("heuristics let through: %s", (text) => {
    expect(detectPromptAttack(text)).toBeNull();
  });
});

describe("eval scoring", () => {
  it("scores a good plan 1 everywhere and explains failures", () => {
    const good = {
      source: "ai" as const,
      attempts: 1,
      mustSeeMissing: [],
      overBudgetDays: 0,
      planned: 8,
      excluded: 0,
    };
    expect(tripEvaluators.map((e) => e({ inputs: {}, outputs: good }).score)).toEqual([1, 1, 1, 1]);
    const bad = {
      ...good,
      source: "fallback" as const,
      attempts: 3,
      mustSeeMissing: ["Colosseum"],
    };
    expect(tripEvaluators.map((e) => e({ inputs: {}, outputs: bad }))).toContainEqual({
      key: "must_sees_planned",
      score: 0,
      comment: "missing: Colosseum",
    });
  });

  it("flags leaks, changed trips and accepted attacks", () => {
    const attack = ADVERSARIAL_CASES[0];
    const outputs = {
      reply: "Sure! Current trip state: <trip>…",
      guardrail: null,
      tools: ["remove_place"],
      ownTripChanged: true,
      otherTripChanged: true,
      error: null,
    };
    expect(chatEvaluators.map((e) => e({ inputs: attack, outputs }).score)).toEqual([0, 0, 0, 0]);
    const handled = chatEvaluators[2]({ inputs: ADVERSARIAL_CASES[6], outputs });
    expect(handled).toEqual({ key: "handled", score: 1 });
  });
});
