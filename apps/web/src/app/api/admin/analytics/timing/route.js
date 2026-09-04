import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { getAdminSessionUser } from "@/lib/auth/admin-api-guard";
import { isAdminUser } from "@/lib/auth/constants";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

/**
 * P4 (peak-listening-time / day-of-week only). Entirely read-side over
 * get_listening_time_patterns — no new write-path instrumentation exists or
 * is needed. Bucketed in UTC; see the migration for why.
 */
export async function GET(req) {
  const user = await getAdminSessionUser();
  if (!user || !isAdminUser(user)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = await checkRateLimit(req, {
    routeKey: "admin.analytics.timing",
    limit: 10,
    windowSeconds: 60,
    identifier: user.id,
  });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterSeconds);

  const admin = getAdminClient();
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await admin.rpc("get_listening_time_patterns", { since: ninetyDaysAgo });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const cells = (data || []).map((row) => ({
    hour: Number(row.hour_of_day),
    day: Number(row.day_of_week),
    plays: Number(row.plays) || 0,
  }));

  let peak = null;
  for (const cell of cells) {
    if (!peak || cell.plays > peak.plays) peak = cell;
  }

  const byHour = Array.from({ length: 24 }, () => 0);
  const byDay = Array.from({ length: 7 }, () => 0);
  for (const cell of cells) {
    byHour[cell.hour] += cell.plays;
    byDay[cell.day] += cell.plays;
  }
  const peakHour = byHour.reduce((best, plays, hour) => (plays > (best?.plays ?? -1) ? { hour, plays } : best), null);
  const peakDay = byDay.reduce((best, plays, day) => (plays > (best?.plays ?? -1) ? { day, plays } : best), null);

  return NextResponse.json(
    { cells, peakCell: peak, peakHour, peakDay },
    { headers: { "Cache-Control": "private, max-age=300" } }
  );
}
