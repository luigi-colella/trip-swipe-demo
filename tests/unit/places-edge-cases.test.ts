import { getTableConfig } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import { deckReducer, type DeckState } from "@/lib/deck";
import { truncateText, type PlaceCard } from "@/lib/places";
import { openDatabase } from "@/server/db/connection";
import { itineraries, places, swipes, trips } from "@/server/db/schema";
import { LruCache, parsePhotonResponse } from "@/server/places/photon";
import { htmlToText, parseCommonsResponse, parseWikiResponse } from "@/server/places/wikipedia";
import { toPlaceCard } from "@/server/trips/trips";

const card = (id: string): PlaceCard => ({
  id,
  name: id,
  category: "museum",
  tags: ["art"],
  pitch: "",
  visitMinutes: 60,
  popularity: 100,
  wikiUrl: "https://en.wikipedia.org/wiki/X",
  imageUrl: null,
  imageAuthor: null,
  imageLicense: null,
  imageLicenseUrl: null,
  imagePageUrl: null,
});

describe("deck reducer edge cases", () => {
  const state: DeckState = {
    deck: [card("a"), card("b")],
    history: [{ place: card("z"), decision: "like" }],
    interests: [],
  };

  it("ignores actions about places it does not know", () => {
    expect(deckReducer(state, { type: "swipe", placeId: "x", decision: "like" })).toBe(state);
    expect(deckReducer(state, { type: "revert-swipe", placeId: "x" })).toBe(state);
    expect(
      deckReducer(state, { type: "revert-undo", entry: { place: card("x"), decision: "like" } }),
    ).toBe(state);
  });

  it("appends nothing when every loaded place is already known", () => {
    expect(deckReducer(state, { type: "append", places: [card("a"), card("z")] })).toBe(state);
  });

  it("ranks fresh places by learned weights before appending them", () => {
    const next = deckReducer(state, { type: "append", places: [card("c"), card("a")] });
    expect(next.deck.map((p) => p.id)).toEqual(["a", "b", "c"]);
  });
});

describe("text truncation", () => {
  it("cuts mid-word when the last space is too early", () => {
    expect(truncateText("a bcdefghijklmnop", 10)).toBe("a bcdefgh…");
  });
});

describe("photon edge cases", () => {
  it("keeps cities without a state and deduplicates them", () => {
    const feature = (osmId: number) => ({
      geometry: { coordinates: [2.35, 48.85] },
      properties: {
        osm_type: "R",
        osm_id: osmId,
        name: "Paris",
        country: "France",
        countrycode: "fr",
      },
    });
    const cities = parsePhotonResponse({ features: [feature(1), feature(2)] });
    expect(cities).toEqual([
      {
        osmRef: "R1",
        name: "Paris",
        state: null,
        country: "France",
        countryCode: "FR",
        lat: 48.85,
        lon: 2.35,
      },
    ]);
  });

  it("evicts the least recently used entry", () => {
    const lru = new LruCache<number>(2);
    lru.set("a", 1);
    lru.set("b", 2);
    expect(lru.get("a")).toBe(1); // a is now the most recent
    lru.set("c", 3);
    expect(lru.get("b")).toBeUndefined();
    expect(lru.get("a")).toBe(1);
    expect(lru.get("c")).toBe(3);
    lru.set("c", 4); // overwriting does not evict
    expect([lru.get("a"), lru.get("c")]).toEqual([1, 4]);
  });
});

describe("wikipedia edge cases", () => {
  it("handles answers without a query block", () => {
    expect(parseWikiResponse(["X"], {}).get("X")).toBeNull();
    expect(parseCommonsResponse(["X.jpg"], {}).get("X.jpg")).toBeNull();
  });

  it("falls back for missing optional fields", () => {
    const result = parseWikiResponse(["Plain Place"], {
      query: {
        pages: [
          {
            title: "Plain Place",
            extract: "   ",
            coordinates: [
              { lat: 1, lon: 2 },
              { lat: 3, lon: 4 },
            ],
            pageimage: "No_thumb.jpg",
          },
        ],
      },
    });
    expect(result.get("Plain Place")).toEqual({
      title: "Plain Place",
      url: "https://en.wikipedia.org/wiki/Plain_Place",
      extract: null,
      // Without a primary coordinate the first one is used.
      lat: 1,
      lon: 2,
      popularity: 0,
      image: null,
    });
  });

  it("credits an unknown author when the artist is missing or blank", () => {
    const page = (title: string, artist?: string) => ({
      title,
      imageinfo: [
        {
          extmetadata: {
            ...(artist === undefined ? {} : { Artist: { value: artist } }),
            LicenseShortName: { value: "CC0" },
            LicenseUrl: { value: "https://creativecommons.org/publicdomain/zero/1.0/" },
          },
        },
      ],
    });
    const credits = parseCommonsResponse(["A.jpg", "B.jpg"], {
      query: { pages: [page("File:A.jpg"), page("File:B.jpg", "<span> </span>")] },
    });
    expect(credits.get("A.jpg")?.author).toBe("Unknown author");
    expect(credits.get("B.jpg")?.author).toBe("Unknown author");
    expect(credits.get("A.jpg")?.licenseUrl).toBe(
      "https://creativecommons.org/publicdomain/zero/1.0/",
    );
  });
});

describe("wikipedia text and URLs", () => {
  it("decodes numeric entities in credits", () => {
    expect(htmlToText("Caf&#233; &#039;Roma&#39; &lt;b&gt;")).toBe("Café 'Roma' <b>");
  });

  it("removes only tracking parameters from thumbnail URLs", () => {
    const result = parseWikiResponse(["P"], {
      query: {
        pages: [
          {
            title: "P",
            coordinates: [{ lat: 1, lon: 2, primary: true }],
            pageimage: "P.jpg",
            thumbnail: { source: "https://upload.wikimedia.org/p.jpg?width=640&utm_medium=api" },
          },
        ],
      },
    });
    expect(result.get("P")?.image?.thumbUrl).toBe("https://upload.wikimedia.org/p.jpg?width=640");
  });

  const ORIGINAL = "https://upload.wikimedia.org/wikipedia/commons/8/82/Sistina-interno.jpg";
  it.each([
    // An unscaled raster original at least 500 px wide: its 500 px standard thumbnail.
    [
      `${ORIGINAL}?utm_content=thumbnail_unscaled`,
      782,
      "https://upload.wikimedia.org/wikipedia/commons/thumb/8/82/Sistina-interno.jpg/500px-Sistina-interno.jpg",
    ],
    [ORIGINAL, 500, expect.stringContaining("/thumb/8/82/Sistina-interno.jpg/500px-")],
    // Too narrow for a smaller standard width, or width unknown: the original as is.
    [ORIGINAL, 499, ORIGINAL],
    [ORIGINAL, undefined, ORIGINAL],
    // Not a raster original (SVG thumbnails are PNGs), already a thumbnail, another host.
    [
      "https://upload.wikimedia.org/wikipedia/commons/a/ab/Map.svg",
      800,
      "https://upload.wikimedia.org/wikipedia/commons/a/ab/Map.svg",
    ],
    [
      "https://upload.wikimedia.org/wikipedia/commons/thumb/d/de/C.jpg/960px-C.jpg",
      640,
      "https://upload.wikimedia.org/wikipedia/commons/thumb/d/de/C.jpg/960px-C.jpg",
    ],
    [
      "https://example.org/wikipedia/commons/8/82/S.jpg",
      800,
      "https://example.org/wikipedia/commons/8/82/S.jpg",
    ],
  ])("sizes the photo %s (%s px wide)", (source, width, expected) => {
    const result = parseWikiResponse(["P"], {
      query: {
        pages: [
          {
            title: "P",
            coordinates: [{ lat: 1, lon: 2, primary: true }],
            pageimage: "P.jpg",
            thumbnail: { source, width },
          },
        ],
      },
    });
    expect(result.get("P")?.image?.thumbUrl).toEqual(expected);
  });
});

describe("client-safe place cards", () => {
  it("replaces an unsafe Wikipedia link with the Wikipedia home page", () => {
    const row = {
      id: "p",
      cityId: "c",
      wikiTitle: "P",
      wikiUrl: "javascript:alert(1)",
      name: "P",
      category: "landmark",
      tags: [],
      pitch: "",
      extract: null,
      imageUrl: null,
      imageAuthor: null,
      imageLicense: null,
      imageLicenseUrl: null,
      imagePageUrl: null,
      lat: 0,
      lon: 0,
      visitMinutes: 60,
      popularity: 0,
      fetchedAt: new Date(),
    };
    expect(toPlaceCard(row).wikiUrl).toBe("https://en.wikipedia.org/");
  });
});

describe("database setup", () => {
  it("opens in-memory databases without touching the file system", () => {
    const { sqlite } = openDatabase(":memory:");
    expect(sqlite.memory).toBe(true);
    sqlite.close();
  });

  it("declares the foreign keys between domain tables", () => {
    const targets = (table: Parameters<typeof getTableConfig>[0]) =>
      getTableConfig(table).foreignKeys.map((fk) => {
        const ref = fk.reference();
        return `${ref.columns[0].name}->${getTableConfig(ref.foreignTable).name}.${ref.foreignColumns[0].name}`;
      });
    expect(targets(places)).toEqual(["city_id->cities.id"]);
    expect(targets(trips)).toEqual(["city_id->cities.id"]);
    expect(targets(swipes).sort()).toEqual(["place_id->places.id", "trip_id->trips.id"]);
    expect(targets(itineraries)).toEqual(["trip_id->trips.id"]);
  });
});
