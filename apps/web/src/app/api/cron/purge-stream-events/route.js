import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";

function authorizeCron(request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  const header = request.headers.get("authorization") ?? "";
  if (header === `Bearer ${secret}`) return true;
  return request.headers.get("x-cron-secret") === secret;
}

export async function GET(request) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const admin = getAdminClient();
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

    const { data, error } = await admin
      .from("media_stream_events")
      .delete()
      .lt("created_at", cutoff)
      .select("id");

    if (error) throw error;
    return NextResponse.json({ purged: data?.length || 0, cutoff });
  } catch (err) {
    console.error("purge-stream-events cron:", err);
    return NextResponse.json({ error: err.message || "Cron failed" }, { status: 500 });
  }
}

export async function POST(request) {
  return GET(request);
}
