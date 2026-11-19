import { NextResponse } from "next/server";

/**
 * Retired. Analytics history is the artist's permanent career record —
 * plays, downloads, purchases and every other stat are kept for life.
 *
 * This route used to delete every media_stream_events row older than 90 days
 * on a weekly Vercel cron, which silently destroyed history (production lost
 * everything before 2026-08-17 that way). The cron entry is gone from both
 * vercel.json files and this handler no longer touches the database at all.
 * Long-range performance is handled by rollups, never by deleting raw events.
 *
 * The path stays registered (route-access-policy.js) so an old scheduler or a
 * manual call gets an explicit answer instead of a 404 that looks like an outage.
 */
function retired() {
  return NextResponse.json(
    {
      purged: 0,
      retired: true,
      reason: "Analytics history is permanent. Nothing is deleted.",
    },
    { status: 410 }
  );
}

export async function GET() {
  return retired();
}

export async function POST() {
  return retired();
}
