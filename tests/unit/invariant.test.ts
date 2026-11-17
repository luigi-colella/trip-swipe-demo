import { describe, expect, it } from "vitest";
import { defined } from "@/lib/invariant";

describe("defined", () => {
  it("returns present values, including falsy ones", () => {
    expect(defined("x", "a value")).toBe("x");
    expect(defined(0, "a number")).toBe(0);
    expect(defined("", "a string")).toBe("");
    expect(defined(false, "a flag")).toBe(false);
  });

  it("throws a descriptive error for null and undefined", () => {
    expect(() => defined(undefined, "the trip")).toThrow("Invariant failed: missing the trip.");
    expect(() => defined(null, "the place")).toThrow("Invariant failed: missing the place.");
  });
});
