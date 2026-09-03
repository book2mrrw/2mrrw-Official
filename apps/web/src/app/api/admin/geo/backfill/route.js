import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { getAdminSessionUser } from "@/lib/auth/admin-api-guard";
import { isAdminUser } from "@/lib/auth/constants";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import { geocodeProfileIfNeeded } from "@/lib/geo/geocode-profile";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BATCH_SIZE = 200;

/**
 * Re-runnable backfill for profiles created before geo_lat/geo_lng existed
 * (or whose city/state/country never resolved at signup time — e.g. no
 * MAPBOX_GEOCODING_TOKEN was configured yet). Batched and safe to call
 * repeatedly: each call only picks up rows still missing a resolution, so
 * catching up a large existing user base is just a matter of triggering this
 * on a schedule (or by hand) until stats.remaining reaches 0.
 */
export async function POST(req) {
  const user = await getAdminSessionUser();
  if (!user || !isAdminUser(user)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = await checkRateLimit(req, {
    routeKey: "admin.geo.backfill",
    limit: 10,
    windowSeconds: 60,
    identifier: user.id,
  });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterSeconds);

  const admin = getAdminClient();

  const { data: candidates, error } = await admin
    .from("profiles")
    .select("id, city, state, country")
    .is("geo_lat", null)
    .not("city", "is", null)
    .not("country", "is", null)
    .limit(BATCH_SIZE);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const stats = { attempted: candidates?.length || 0, resolved: 0, unresolved: 0 };
  for (const profile of candidates || []) {
    const result = await geocodeProfileIfNeeded(admin, {
      userId: profile.id,
      city: profile.city,
      state: profile.state,
      country: profile.country,
    });
    if (result.resolved) stats.resolved++;
    else stats.unresolved++;
  }

  const { count: remaining } = await admin
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .is("geo_lat", null)
    .not("city", "is", null)
    .not("country", "is", null);

  return NextResponse.json({ ...stats, remaining: remaining || 0 });
}
