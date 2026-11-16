import { connection, type NextRequest } from "next/server";
import { db } from "@/server/db/client";
import { CityQuerySchema, searchCities } from "@/server/places/photon";

/** City autocomplete (F1): GET /api/cities?q=rom */
export async function GET(request: NextRequest) {
  // The cache lookup is a synchronous SQLite read: opt out of build-time prerendering.
  await connection();
  const q = CityQuerySchema.safeParse(request.nextUrl.searchParams.get("q") ?? "");
  if (!q.success) {
    return Response.json({ error: "Query must be 2-80 characters." }, { status: 400 });
  }
  try {
    const cities = await searchCities(q.data, { db });
    return Response.json(
      { cities },
      // Suggestions barely change: let the browser reuse them across keystrokes and visits.
      { headers: { "Cache-Control": "private, max-age=86400" } },
    );
  } catch (err) {
    console.error("City search failed", err);
    return Response.json({ error: "City search is unavailable, please retry." }, { status: 502 });
  }
}
