import { describe, expect, it } from "vitest";
import {
  normalizeCategory,
  normalizePitch,
  normalizeTags,
  normalizeVisitMinutes,
  truncateText,
} from "@/lib/places";
import { rankByInterests } from "@/lib/ranking";
import { haversineKm } from "@/lib/geo";
import { citySlug } from "@/server/places/cities";
import { selectGroundedCandidates } from "@/server/places/discover";
import { parsePhotonResponse } from "@/server/places/photon";
import {
  htmlToText,
  isValidWikiTitle,
  parseCommonsResponse,
  parseWikiResponse,
  type WikiPage,
} from "@/server/places/wikipedia";

describe("place vocabulary normalization", () => {
  it("maps categories to the vocabulary and falls back to landmark", () => {
    expect(normalizeCategory("Historic Site")).toBe("historic-site");
    expect(normalizeCategory("Museum")).toBe("museum");
    expect(normalizeCategory("rooftop bar")).toBe("landmark");
  });

  it("keeps known tags only, deduplicated", () => {
    expect(normalizeTags(["Art", "art", "Hidden gem", "selfies", "views"])).toEqual([
      "art",
      "views",
      "hidden-gem",
    ]);
  });

  it("rounds visit time to 15 minutes within bounds", () => {
    expect(normalizeVisitMinutes(50)).toBe(45);
    expect(normalizeVisitMinutes(2)).toBe(15);
    expect(normalizeVisitMinutes(1000)).toBe(300);
    expect(normalizeVisitMinutes(Number.NaN)).toBe(60);
  });

  it("truncates long text at a word boundary", () => {
    expect(truncateText("short  text ", 50)).toBe("short text");
    const pitch = normalizePitch("word ".repeat(60));
    expect(pitch.length).toBeLessThanOrEqual(160);
    expect(pitch.endsWith("word…")).toBe(true);
  });
});

describe("rankByInterests", () => {
  const places = [
    { name: "Big Museum", category: "museum", tags: ["art"], popularity: 100_000 },
    { name: "Small Park", category: "park", tags: ["nature"], popularity: 1_000 },
    {
      name: "Mid Church",
      category: "religious-site",
      tags: ["religion", "art"],
      popularity: 10_000,
    },
  ];

  it("orders by popularity without interests", () => {
    expect(rankByInterests(places, []).map((p) => p.name)).toEqual([
      "Big Museum",
      "Mid Church",
      "Small Park",
    ]);
  });

  it("promotes places matching the trip's interests", () => {
    expect(rankByInterests(places, ["nature"])[0].name).toBe("Small Park");
    expect(rankByInterests(places, ["religion", "art"])[0].name).toBe("Mid Church");
  });

  it("does not mutate its input", () => {
    const copy = [...places];
    rankByInterests(places, ["nature"]);
    expect(places).toEqual(copy);
  });
});

describe("geo", () => {
  it("computes great-circle distances", () => {
    const colosseum = { lat: 41.8902, lon: 12.4922 };
    const vatican = { lat: 41.9022, lon: 12.4539 };
    expect(haversineKm(colosseum, vatican)).toBeCloseTo(3.4, 1);
    expect(haversineKm(colosseum, colosseum)).toBe(0);
  });
});

describe("photon parsing", () => {
  it("keeps complete features, deduplicates and slugs cities", () => {
    const feature = (name: string, osmId: number, state?: string) => ({
      geometry: { coordinates: [12.48, 41.89] },
      properties: {
        osm_type: "R",
        osm_id: osmId,
        name,
        state,
        country: "Italy",
        countrycode: "it",
      },
    });
    const result = parsePhotonResponse({
      features: [
        feature("Rome", 1, "Lazio"),
        feature("Rome", 2, "Lazio"),
        { geometry: { coordinates: [0, 0] }, properties: { name: "No country" } },
      ],
    });
    expect(result).toEqual([
      {
        osmRef: "R1",
        name: "Rome",
        state: "Lazio",
        country: "Italy",
        countryCode: "IT",
        lat: 41.89,
        lon: 12.48,
      },
    ]);
    expect(citySlug(result[0])).toBe("rome-lazio-it");
    expect(citySlug({ name: "São Paulo", state: null, countryCode: "BR" })).toBe("sao-paulo-br");
  });

  it("returns nothing for unexpected payloads", () => {
    expect(parsePhotonResponse({ error: "boom" })).toEqual([]);
  });
});

describe("wikipedia parsing", () => {
  it("follows normalization and redirects; drops missing, disambiguation and coordinate-less pages", () => {
    const body = {
      query: {
        normalized: [{ from: "colosseo", to: "Colosseo" }],
        redirects: [{ from: "Colosseo", to: "Colosseum" }],
        pages: [
          {
            title: "Colosseum",
            fullurl: "https://en.wikipedia.org/wiki/Colosseum",
            extract: "An amphitheatre.",
            coordinates: [{ lat: 41.89, lon: 12.49, primary: true }],
            pageimage: "Colosseo_2020.jpg",
            thumbnail: {
              source: "https://upload.wikimedia.org/c.jpg?utm_source=en&utm_campaign=api",
            },
            pageviews: { a: 10, b: null, c: 5 },
          },
          {
            title: "Mercury",
            coordinates: [{ lat: 0, lon: 0 }],
            pageprops: { disambiguation: "" },
          },
          { title: "Nowhere", extract: "No coordinates." },
          { title: "Fake Place", missing: true },
        ],
      },
    };
    const result = parseWikiResponse(["colosseo", "Mercury", "Nowhere", "Fake Place"], body);
    expect(result.get("colosseo")).toEqual({
      title: "Colosseum",
      url: "https://en.wikipedia.org/wiki/Colosseum",
      extract: "An amphitheatre.",
      lat: 41.89,
      lon: 12.49,
      popularity: 15,
      image: { fileName: "Colosseo_2020.jpg", thumbUrl: "https://upload.wikimedia.org/c.jpg" },
    });
    expect(result.get("Mercury")).toBeNull();
    expect(result.get("Nowhere")).toBeNull();
    expect(result.get("Fake Place")).toBeNull();
  });

  it("rejects titles that would break the batched query", () => {
    expect(isValidWikiTitle("Colosseum")).toBe(true);
    expect(isValidWikiTitle("A|B")).toBe(false);
    expect(isValidWikiTitle("")).toBe(false);
  });

  it("extracts plain-text photo credits and drops files without a license", () => {
    const body = {
      query: {
        normalized: [{ from: "File:A_b.jpg", to: "File:A b.jpg" }],
        pages: [
          {
            title: "File:A b.jpg",
            imageinfo: [
              {
                extmetadata: {
                  Artist: { value: '<a href="//x">Jane&nbsp;Doe</a> &amp; <b>co</b>' },
                  LicenseShortName: { value: "CC BY 4.0" },
                  LicenseUrl: { value: "javascript:alert(1)" },
                },
              },
            ],
          },
          { title: "File:Nolicense.jpg", imageinfo: [{ extmetadata: {} }] },
        ],
      },
    };
    const credits = parseCommonsResponse(["A_b.jpg", "Nolicense.jpg"], body);
    expect(credits.get("A_b.jpg")).toEqual({
      author: "Jane Doe & co",
      license: "CC BY 4.0",
      licenseUrl: null,
      pageUrl: "https://commons.wikimedia.org/wiki/File:A_b.jpg",
    });
    expect(credits.get("Nolicense.jpg")).toBeNull();
    expect(htmlToText("<script>x</script>Name")).toBe("x Name");
  });
});

describe("selectGroundedCandidates", () => {
  const rome = { lat: 41.8933, lon: 12.4829 };
  const page = (title: string, lat: number, lon: number): WikiPage => ({
    title,
    url: `https://en.wikipedia.org/wiki/${title}`,
    extract: null,
    lat,
    lon,
    popularity: 1,
    image: null,
  });
  const candidate = (wikiTitle: string) => ({
    name: wikiTitle,
    wikiTitle,
    category: "landmark" as const,
    tags: [],
    visitMinutes: 60,
    pitch: "",
  });

  it("drops unmatched, distant and duplicate candidates with a reason", () => {
    const pages = new Map([
      ["Colosseum", page("Colosseum", 41.89, 12.49)],
      ["Colosseo", page("Colosseum", 41.89, 12.49)],
      ["Pompeii", page("Pompeii", 40.75, 14.49)],
      ["Pantheon, Rome", page("Pantheon, Rome", 41.8986, 12.4769)],
    ]);
    const { kept, dropped } = selectGroundedCandidates(
      rome,
      ["Colosseum", "Colosseo", "Pompeii", "Made Up", "A|B", "Pantheon, Rome"].map(candidate),
      pages,
      new Set(["Pantheon, Rome"]),
    );
    expect(kept.map((k) => k.page.title)).toEqual(["Colosseum"]);
    expect(dropped).toEqual([
      { wikiTitle: "Colosseo", reason: "duplicate" },
      { wikiTitle: "Pompeii", reason: "too-far" },
      { wikiTitle: "Made Up", reason: "not-on-wikipedia" },
      { wikiTitle: "A|B", reason: "invalid-title" },
      { wikiTitle: "Pantheon, Rome", reason: "duplicate" },
    ]);
  });
});
