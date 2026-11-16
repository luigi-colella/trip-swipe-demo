import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const createdAt = () =>
  integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`);

export const PACES = ["relaxed", "balanced", "intense"] as const;
export const SWIPE_DECISIONS = ["like", "skip", "must"] as const;
export const TRIP_STATUSES = ["swiping", "review", "itinerary"] as const;

export const cities = sqliteTable("cities", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  country: text("country").notNull(),
  lat: real("lat").notNull(),
  lon: real("lon").notNull(),
  createdAt: createdAt(),
});

export const places = sqliteTable(
  "places",
  {
    id: text("id").primaryKey(),
    cityId: text("city_id")
      .notNull()
      .references(() => cities.id, { onDelete: "cascade" }),
    wikiTitle: text("wiki_title").notNull(),
    wikiUrl: text("wiki_url").notNull(),
    name: text("name").notNull(),
    category: text("category").notNull(),
    tags: text("tags", { mode: "json" }).$type<string[]>().notNull().default([]),
    pitch: text("pitch").notNull(),
    extract: text("extract"),
    imageUrl: text("image_url"),
    imageAuthor: text("image_author"),
    imageLicense: text("image_license"),
    imageLicenseUrl: text("image_license_url"),
    /** Wikimedia Commons file page: full attribution details for the photo. */
    imagePageUrl: text("image_page_url"),
    lat: real("lat").notNull(),
    lon: real("lon").notNull(),
    visitMinutes: integer("visit_minutes").notNull(),
    popularity: integer("popularity").notNull().default(0),
    fetchedAt: integer("fetched_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [uniqueIndex("places_city_wiki_idx").on(t.cityId, t.wikiTitle)],
);

export const trips = sqliteTable("trips", {
  id: text("id").primaryKey(),
  cityId: text("city_id")
    .notNull()
    .references(() => cities.id),
  days: integer("days").notNull(),
  pace: text("pace", { enum: PACES }).notNull(),
  interests: text("interests", { mode: "json" }).$type<string[]>().notNull().default([]),
  tagWeights: text("tag_weights", { mode: "json" })
    .$type<Record<string, number>>()
    .notNull()
    .default({}),
  status: text("status", { enum: TRIP_STATUSES }).notNull().default("swiping"),
  createdAt: createdAt(),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const swipes = sqliteTable(
  "swipes",
  {
    tripId: text("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    placeId: text("place_id")
      .notNull()
      .references(() => places.id, { onDelete: "cascade" }),
    decision: text("decision", { enum: SWIPE_DECISIONS }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.tripId, t.placeId] })],
);

export const itineraries = sqliteTable(
  "itineraries",
  {
    id: text("id").primaryKey(),
    tripId: text("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    data: text("data", { mode: "json" }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("itineraries_trip_version_idx").on(t.tripId, t.version)],
);

/** Raw third-party HTTP responses (Photon, Wikipedia) with TTL. */
export const httpCache = sqliteTable(
  "http_cache",
  {
    key: text("key").primaryKey(),
    body: text("body", { mode: "json" }).notNull(),
    fetchedAt: integer("fetched_at", { mode: "timestamp" }).notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [index("http_cache_expires_idx").on(t.expiresAt)],
);

/** Exact-match LLM response cache (discovery / planner roles only). */
export const llmCache = sqliteTable(
  "llm_cache",
  {
    key: text("key").primaryKey(),
    value: text("value", { mode: "json" }).notNull(),
    createdAt: createdAt(),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [index("llm_cache_expires_idx").on(t.expiresAt)],
);

/** Fixed-window counters for rate limits and the daily LLM budget. */
export const rateLimits = sqliteTable(
  "rate_limits",
  {
    key: text("key").notNull(),
    windowStart: integer("window_start").notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.key, t.windowStart] })],
);
