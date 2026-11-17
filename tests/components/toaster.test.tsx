import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Toaster, toast } from "@/components/toast";

describe("Toaster", () => {
  it("loads sonner on the first toast and shows it in the light theme", async () => {
    render(<Toaster />);
    expect(document.querySelector("[data-sonner-toaster]")).toBeNull();

    act(() => toast.success("Saved."));
    expect(await screen.findByText("Saved.")).toBeTruthy();
    expect(document.querySelector("[data-sonner-toaster]")?.getAttribute("data-sonner-theme")).toBe(
      "light",
    );
  });

  it("shows every kind of toast once loaded, the toaster mounted only once", async () => {
    render(<Toaster />);
    act(() => {
      toast.info("Info.");
      toast.warning("Warning.");
      toast.error("Error.");
    });
    for (const text of ["Info.", "Warning.", "Error."]) {
      expect(await screen.findByText(text)).toBeTruthy();
    }
    expect(document.querySelectorAll("[data-sonner-toaster]")).toHaveLength(1);
  });

  it("loads sonner once the page has loaded, so later toasts need no network", async () => {
    const readyState = vi.spyOn(document, "readyState", "get").mockReturnValue("loading");
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    const first = render(<Toaster />);
    first.unmount(); // a toaster gone before the page loaded stops waiting for it
    expect(remove).toHaveBeenCalledWith("load", expect.any(Function));
    render(<Toaster />);
    const loads = add.mock.calls.filter(([type]) => type === "load");
    expect(loads).toHaveLength(2);
    readyState.mockRestore();
    act(() => void window.dispatchEvent(new Event("load")));
    act(() => toast.info("Ready."));
    expect(await screen.findByText("Ready.")).toBeTruthy();
  });
});
