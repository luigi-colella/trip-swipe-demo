import { z } from "zod";
import { cachedJson, DAY_MS, fetchJson, type HttpDeps } from "./http-cache";
import { defined } from "@/lib/invariant";

/** City autocomplete through Photon (komoot), backed by OpenStreetMap. */
const PHOTON_URL = "https://photon.komoot.io/api/";
const PHOTON_TTL_MS = 30 * DAY_MS;
const MAX_RESULTS = 6;

export const CityQuerySchema = z.string().trim().min(2).max(80);

export type CitySuggestion = {
  /** Stable OpenStreetMap reference, e.g. "R41485". */
  osmRef: string;
  name: string;
  state: string | null;
  country: string;
  countryCode: string;
  lat: number;
  lon: number;
};

const PhotonResponse = z.object({
  features: z.array(
    z.object({
      geometry: z.object({ coordinates: z.tuple([z.number(), z.number()]) }),
      properties: z.object({
        osm_type: z.string().optional(),
        osm_id: z.number().optional(),
        name: z.string().optional(),
        state: z.string().optional(),
        country: z.string().optional(),
        countrycode: z.string().optional(),
      }),
    }),
  ),
});

export function parsePhotonResponse(body: unknown): CitySuggestion[] {
  const parsed = PhotonResponse.safeParse(body);
  if (!parsed.success) return [];
  const seen = new Set<string>();
  const out: CitySuggestion[] = [];
  for (const f of parsed.data.features) {
    const p = f.properties;
    if (!p.name || !p.country || !p.countrycode || !p.osm_type || p.osm_id === undefined) continue;
    const dedupeKey = `${p.name}|${p.state ?? ""}|${p.countrycode}`.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    const [lon, lat] = f.geometry.coordinates;
    out.push({
      osmRef: `${p.osm_type}${p.osm_id}`,
      name: p.name,
      state: p.state ?? null,
      country: p.country,
      countryCode: p.countrycode.toUpperCase(),
      lat,
      lon,
    });
  }
  return out;
}

/** Small in-memory L1 cache for autocomplete keystrokes (lost on restart by design). */
export class LruCache<V> {
  private map = new Map<string, V>();
  constructor(private readonly max: number) {}
  get(key: string): V | undefined {
    const v = this.map.get(key);
    if (v !== undefined) {
      this.map.delete(key);
      this.map.set(key, v);
    }
    return v;
  }
  set(key: string, value: V) {
    this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.max)
      this.map.delete(defined(this.map.keys().next().value, "the oldest key"));
  }
}

const l1 = new LruCache<CitySuggestion[]>(500);

/** L1 memory → L2 `http_cache` (30 days) → Photon. `query` must pass CityQuerySchema. */
export async function searchCities(query: string, deps: HttpDeps): Promise<CitySuggestion[]> {
  const q = query.trim().toLowerCase().replace(/\s+/g, " ");
  const memo = l1.get(q);
  if (memo) return memo;

  const url = `${PHOTON_URL}?${new URLSearchParams({
    q,
    layer: "city",
    lang: "en",
    limit: String(MAX_RESULTS),
  })}`;
  const body = await cachedJson(deps, `photon:${q}`, PHOTON_TTL_MS, () => fetchJson(url));
  const result = parsePhotonResponse(body);
  l1.set(q, result);
  return result;
}
