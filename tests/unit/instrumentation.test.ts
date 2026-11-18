import { afterEach, describe, expect, it, vi } from "vitest";
import { register } from "@/instrumentation";
import { FAKE_DISCOVERY_CITIES, offlineModeHint } from "@/server/ai/fake";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("offlineModeHint", () => {
  it("names the fixture cities and how to switch, in fake mode only", () => {
    expect(FAKE_DISCOVERY_CITIES).toEqual(["Rome", "Paris"]);
    expect(offlineModeHint("fake")).toBe(
      "Offline demo mode (LLM_MODE=fake): only Rome and Paris have built-in attractions, " +
        "plus cities already saved in your database. " +
        "Set LLM_MODE=live in .env.local to explore any city.",
    );
    expect(offlineModeHint("live")).toBeUndefined();
  });
});

describe("register (startup)", () => {
  it("warns once about the offline mode on the Node.js runtime", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("LLM_MODE", "fake");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await register();
    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(offlineModeHint("fake"));
  });

  it("stays silent in live mode", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("LLM_MODE", "live");
    vi.stubEnv("OPENROUTER_API_KEY", "sk-test");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await register();
    expect(warn).not.toHaveBeenCalled();
  });

  it("leaves an invalid environment to the first request instead of failing the startup", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("LLM_MODE", "live");
    vi.stubEnv("OPENROUTER_API_KEY", "");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(register()).resolves.toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });

  it("does nothing on the edge runtime", async () => {
    vi.stubEnv("NEXT_RUNTIME", "edge");
    vi.stubEnv("LLM_MODE", "fake");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await register();
    expect(warn).not.toHaveBeenCalled();
  });
});
