import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
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
});
