import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PlaceCardView } from "@/components/swipe/place-card";
import { PlacePhoto } from "@/components/swipe/place-photo";
import { placeCard } from "./fixtures";

describe("PlaceCardView (F2, F9)", () => {
  it("shows the name, category, visit time, pitch and Wikipedia provenance", () => {
    render(<PlaceCardView place={placeCard("Colosseum", { visitMinutes: 90 })} />);
    expect(screen.getByRole("heading", { name: "Colosseum" })).toBeTruthy();
    expect(screen.getByText("Historic site")).toBeTruthy();
    expect(screen.getByText("1 h 30 min")).toBeTruthy();
    expect(screen.getByText("Colosseum pitch.")).toBeTruthy();
    const wiki = screen.getByRole("link", { name: "Verified on Wikipedia" });
    expect(wiki.getAttribute("href")).toBe("https://en.wikipedia.org/wiki/Colosseum");
    expect(wiki.getAttribute("rel")).toBe("noopener noreferrer");
    // No photo: a neutral placeholder and no credit line.
    expect(screen.getByRole("img", { name: "Colosseum (no photo available)" })).toBeTruthy();
    expect(screen.queryByText(/Photo:/)).toBeNull();
  });

  it("credits the photo author and license with links when known", () => {
    render(
      <PlaceCardView
        eager
        place={placeCard("Pantheon", {
          imageUrl: "https://upload.wikimedia.org/p.jpg",
          imageAuthor: "Ann",
          imageLicense: "CC BY-SA 4.0",
          imageLicenseUrl: "https://creativecommons.org/licenses/by-sa/4.0",
          imagePageUrl: "https://commons.wikimedia.org/wiki/File:P.jpg",
        })}
      />,
    );
    const img = screen.getByRole("img", { name: "Pantheon" });
    expect(img.getAttribute("src")).toBe("https://upload.wikimedia.org/p.jpg");
    expect(img.getAttribute("loading")).toBe("eager");
    expect(screen.getByRole("link", { name: "Ann" }).getAttribute("href")).toBe(
      "https://commons.wikimedia.org/wiki/File:P.jpg",
    );
    expect(screen.getByRole("link", { name: "CC BY-SA 4.0" }).getAttribute("href")).toBe(
      "https://creativecommons.org/licenses/by-sa/4.0",
    );
  });

  it("falls back to plain text when author, license or their links are unknown", () => {
    const { rerender } = render(
      <PlaceCardView
        place={placeCard("Trevi", {
          imageUrl: "https://upload.wikimedia.org/t.jpg",
          imageLicense: "CC0",
        })}
      />,
    );
    expect(screen.getByText(/Unknown author/)).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Unknown author" })).toBeNull();
    expect(screen.getByText(/CC0/)).toBeTruthy();
    expect(screen.queryByRole("link", { name: "CC0" })).toBeNull();

    rerender(
      <PlaceCardView
        place={placeCard("Trevi", { imageUrl: "https://upload.wikimedia.org/t.jpg" })}
      />,
    );
    expect(screen.getByText("Photo:", { exact: false }).textContent).toBe("Photo: Unknown author");
  });
});

describe("PlacePhoto", () => {
  it("loads lazily and swaps to the placeholder when the image fails", () => {
    render(<PlacePhoto src="https://upload.wikimedia.org/x.jpg" alt="Forum" sizes="64px" />);
    const img = screen.getByRole("img", { name: "Forum" });
    expect(img.getAttribute("loading")).toBe("lazy");
    fireEvent.error(img);
    expect(screen.getByRole("img", { name: "Forum (no photo available)" })).toBeTruthy();
  });
});
