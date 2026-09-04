import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { getAdminSessionUser } from "@/lib/auth/admin-api-guard";
import { isAdminUser } from "@/lib/auth/constants";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

/**
 * P3: acquisition funnel, cohort retention, and first-touch attribution
 * breakdown. Entirely read-side over get_funnel_stats/get_cohort_retention/
 * get_attribution_breakdown — no new write-path instrumentation exists or is
 * needed, since every step (signup, first stream, first purchase) is already
 * derivable from profiles/media_stream_events/purchases.
 */
export async function GET(req) {
  const user = await getAdminSessionUser();
  if (!user || !isAdminUser(user)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = await checkRateLimit(req, {
    routeKey: "admin.analytics.funnels",
    limit: 10,
    windowSeconds: 60,
    identifier: user.id,
  });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterSeconds);

  const admin = getAdminClient();
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

  const [funnelResult, cohortResult, attributionResult] = await Promise.all([
    admin.rpc("get_funnel_stats", { since: ninetyDaysAgo }).maybeSingle(),
    admin.rpc("get_cohort_retention", { months_back: 6 }),
    admin.rpc("get_attribution_breakdown", { since: ninetyDaysAgo }),
  ]);

  const funnelRow = funnelResult.data || { signups: 0, streamed: 0, purchased: 0 };
  const funnel = {
    signups: Number(funnelRow.signups) || 0,
    streamed: Number(funnelRow.streamed) || 0,
    purchased: Number(funnelRow.purchased) || 0,
  };

  const cohorts = (cohortResult.data || []).map((row) => ({
    cohortMonth: row.cohort_month,
    cohortSize: Number(row.cohort_size) || 0,
    monthOffset: Number(row.month_offset),
    retainedFans: Number(row.retained_fans) || 0,
  }));

  const attribution = (attributionResult.data || []).map((row) => ({
    source: row.source,
    medium: row.medium,
    campaign: row.campaign,
    signups: Number(row.signups) || 0,
    purchases: Number(row.purchases) || 0,
    revenueCents: Number(row.revenue_cents) || 0,
  }));

  return NextResponse.json(
    { funnel, cohorts, attribution },
    { headers: { "Cache-Control": "private, no-store, must-revalidate" } }
  );
}
