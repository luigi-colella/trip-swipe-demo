import { act, render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Toaster, toast } from "@/components/toast";

// The code of the notifications cannot be fetched (offline before it was loaded).
vi.mock("sonner", () => {
  throw new Error("Failed to load chunk");
});
vi.mock("@/components/ui/sonner", () => {
  throw new Error("Failed to load chunk");
});

describe("Toaster without its code", () => {
  it("logs toasts instead of crashing the page", async () => {
    // Regression: offline, the first toast loaded sonner, failed and replaced the whole page.
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { container } = render(
      <main>
        <p>Page</p>
        <Toaster />
      </main>,
    );
    act(() => toast.error("Couldn't reach the server."));
    await waitFor(() =>
      expect(log).toHaveBeenCalledWith(
        'Could not show "Couldn\'t reach the server."',
        expect.anything(),
      ),
    );
    await waitFor(() =>
      expect(log).toHaveBeenCalledWith("Could not load notifications", expect.anything()),
    );
    expect(container.textContent).toBe("Page");
  });
});
