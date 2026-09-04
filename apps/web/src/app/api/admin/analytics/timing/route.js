import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { getAdminSessionUser } from "@/lib/auth/admin-api-guard";
import { isAdminUser } from "@/lib/auth/constants";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

/** Reduces a flat list of {hour, day, plays} cells to overall peak hour/day,
 * summing across the other axis rather than just taking the single busiest cell. */
function summarize(cells) {
  let peakCell = null;
  for (const cell of cells) {
    if (!peakCell || cell.plays > peakCell.plays) peakCell = cell;
  }
  const byHour = Array.from({ length: 24 }, () => 0);
  const byDay = Array.from({ length: 7 }, () => 0);
  for (const cell of cells) {
    byHour[cell.hour] += cell.plays;
    byDay[cell.day] += cell.plays;
  }
  const peakHour = byHour.reduce((best, plays, hour) => (plays > (best?.plays ?? -1) ? { hour, plays } : best), null);
  const peakDay = byDay.reduce((best, plays, day) => (plays > (best?.plays ?? -1) ? { day, plays } : best), null);
  return { peakCell, peakHour, peakDay };
}

/**
 * P4: peak-listening-time / day-of-week, in UTC (cells, for the "Global"
 * view) and per world region in that region's own real local time (regions —
 * DST-correct, via Postgres's IANA timezone database in the migration).
 * Entirely read-side over media_stream_events.country/region, already
 * populated on every play event — no new write-path instrumentation.
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

  const [globalResult, regionalResult] = await Promise.all([
    admin.rpc("get_listening_time_patterns", { since: ninetyDaysAgo }),
    admin.rpc("get_regional_listening_patterns", { since: ninetyDaysAgo }),
  ]);
  if (globalResult.error) {
    return NextResponse.json({ error: globalResult.error.message }, { status: 500 });
  }
  if (regionalResult.error) {
    return NextResponse.json({ error: regionalResult.error.message }, { status: 500 });
  }

  const cells = (globalResult.data || []).map((row) => ({
    hour: Number(row.hour_of_day),
    day: Number(row.day_of_week),
    plays: Number(row.plays) || 0,
  }));
  const { peakCell, peakHour, peakDay } = summarize(cells);

  const cellsByRegion = new Map();
  for (const row of regionalResult.data || []) {
    const region = row.region;
    if (!cellsByRegion.has(region)) cellsByRegion.set(region, []);
    cellsByRegion.get(region).push({
      hour: Number(row.hour_of_day),
      day: Number(row.day_of_week),
      plays: Number(row.plays) || 0,
    });
  }
  const regions = [...cellsByRegion.entries()]
    .map(([region, regionCells]) => {
      const totalPlays = regionCells.reduce((sum, c) => sum + c.plays, 0);
      return { region, cells: regionCells, totalPlays, ...summarize(regionCells) };
    })
    .sort((a, b) => b.totalPlays - a.totalPlays);

  return NextResponse.json(
    { cells, peakCell, peakHour, peakDay, regions },
    { headers: { "Cache-Control": "private, no-store, must-revalidate" } }
  );
}
