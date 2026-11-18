import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { fetchUpcomingShows } from "@/lib/shows/upcoming-shows";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const admin = getAdminClient();
    const shows = await fetchUpcomingShows(admin);
    return NextResponse.json({ shows });
  } catch {
    return NextResponse.json({ shows: [] });
  }
}
