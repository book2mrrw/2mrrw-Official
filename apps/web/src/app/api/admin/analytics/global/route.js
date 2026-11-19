import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { getAdminSessionUser } from "@/lib/auth/admin-api-guard";
import { isAdminUser } from "@/lib/auth/constants";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import { ARTIST_TIME_ZONE, analyticsRange } from "@/lib/analytics/range";
import { buildGeoReport } from "@/lib/analytics/geo-report";

export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;
const GROWTH_WINDOW_MS = 30 * DAY_MS;

/**
 * Global Map data. Listening geography (country → region → city) is counted
 * in SQL by analytics_geo — one tested definition, no raw-row loads, no
 * double counting. since/until scope the current view (lifetime when
 * omitted); growth is always the last 30 days against the 30 before.
 */
export async function GET(req) {
  const user = await getAdminSessionUser();
  if (!user || !isAdminUser(user)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = await checkRateLimit(req, {
    routeKey: "admin.analytics.global",
    limit: 10,
    windowSeconds: 60,
    identifier: user.id,
  });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterSeconds);

  const range = analyticsRange(new URL(req.url).searchParams);
  const now = new Date();
  const windows = {
    currentFrom: new Date(now.getTime() - GROWTH_WINDOW_MS).toISOString(),
    currentTo: now.toISOString(),
    previousFrom: new Date(now.getTime() - 2 * GROWTH_WINDOW_MS).toISOString(),
    previousTo: new Date(now.getTime() - GROWTH_WINDOW_MS).toISOString(),
  };
  const admin = getAdminClient();

  const [overviewRes, currentRes, growthCurrentRes, growthPreviousRes, listenerGrowthRes, purchasesRes] = await Promise.all([
    admin.rpc("analytics_overview", { p_from: range.from, p_to: range.to }).maybeSingle(),
    admin.rpc("analytics_geo", { p_from: range.from, p_to: range.to }),
    admin.rpc("analytics_geo", { p_from: windows.currentFrom, p_to: windows.currentTo }),
    admin.rpc("analytics_geo", { p_from: windows.previousFrom, p_to: windows.previousTo }),
    admin.rpc("analytics_listener_growth", { p_tz: ARTIST_TIME_ZONE }),
    admin.from("purchases").select("user_id, amount_cents, purchased_at").eq("status", "completed").limit(50000),
  ]);

  const failed = [overviewRes, currentRes, growthCurrentRes, growthPreviousRes, listenerGrowthRes, purchasesRes].find((r) => r.error);
  if (failed) {
    console.error("[admin/analytics/global] query failed:", failed.error?.message);
    return NextResponse.json({ error: "Analytics query failed" }, { status: 500 });
  }

  const purchases = purchasesRes.data || [];
  const buyerIds = [...new Set(purchases.map((p) => p.user_id).filter(Boolean))];
  const profilesRes = buyerIds.length
    ? await admin.from("profiles").select("id, country, state, city").in("id", buyerIds)
    : { data: [] };

  const report = buildGeoReport({
    overview: overviewRes.data,
    current: currentRes.data || [],
    growthCurrent: growthCurrentRes.data || [],
    growthPrevious: growthPreviousRes.data || [],
    purchases,
    buyerProfiles: profilesRes.data || [],
    listenerGrowth: listenerGrowthRes.data || [],
    range,
    windows,
    now,
  });

  return NextResponse.json(report, { headers: { "Cache-Control": "private, no-store, must-revalidate" } });
}
