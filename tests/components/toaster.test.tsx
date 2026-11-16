import { act, render, screen } from "@testing-library/react";
import { toast } from "sonner";
import { describe, expect, it } from "vitest";
import { Toaster } from "@/components/ui/sonner";

describe("Toaster", () => {
  it("shows notifications in the light theme", async () => {
    render(<Toaster position="top-center" />);
    act(() => void toast.success("Saved."));
    expect(await screen.findByText("Saved.")).toBeTruthy();
    expect(document.querySelector("[data-sonner-toaster]")?.getAttribute("data-sonner-theme")).toBe(
      "light",
    );
  });
});
