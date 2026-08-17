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
    const now = new Date().toISOString();
    const { data, error } = await admin
      .from("gifts")
      .update({ status: "expired", updated_at: now })
      .eq("status", "pending")
      .lt("expires_at", now)
      .select("id");

    if (error) throw error;
    return NextResponse.json({ expired: data?.length || 0 });
  } catch (err) {
    console.error("expire-gifts cron:", err);
    return NextResponse.json({ error: err.message || "Cron failed" }, { status: 500 });
  }
}

export async function POST(request) {
  return GET(request);
}
