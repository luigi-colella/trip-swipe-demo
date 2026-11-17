import { redirect } from "next/navigation";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CONNECTION_ERROR,
  CONNECTION_FAILURE,
  callServer,
  requestErrorText,
} from "@/components/call-server";

afterEach(() => vi.restoreAllMocks());

describe("callServer", () => {
  it("returns the action's own result, success or failure", async () => {
    await expect(callServer(async () => ({ ok: true }), CONNECTION_FAILURE)).resolves.toEqual({
      ok: true,
    });
    const refused = { ok: false as const, error: "Trip not found." };
    await expect(callServer(async () => refused, CONNECTION_FAILURE)).resolves.toBe(refused);
  });

  it("turns a failed request into the fallback instead of throwing", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const offline = new TypeError("Failed to fetch");
    await expect(callServer(() => Promise.reject(offline), CONNECTION_FAILURE)).resolves.toBe(
      CONNECTION_FAILURE,
    );
    expect(log).toHaveBeenCalledWith("Server Action failed", offline);
  });

  it("lets an action's redirect through", async () => {
    let redirectError: unknown;
    try {
      redirect("/trip/x/review");
    } catch (err) {
      redirectError = err;
    }
    await expect(callServer(() => Promise.reject(redirectError), CONNECTION_FAILURE)).rejects.toBe(
      redirectError,
    );
  });
});

describe("requestErrorText", () => {
  it("explains network failures and keeps the server's own messages", () => {
    expect(requestErrorText(new TypeError("Failed to fetch"))).toBe(CONNECTION_ERROR);
    expect(requestErrorText(new Error("Message too long."))).toBe("Message too long.");
  });
});
