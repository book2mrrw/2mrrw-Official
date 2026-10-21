import { NextResponse } from "next/server";
import { getDeletedReleaseSlugs } from "@/lib/releases/deletion-server";

export const dynamic = "force-dynamic";

export async function GET() {
  const headers = { "Cache-Control": "private, no-store" };
  try {
    return NextResponse.json({ slugs: [...await getDeletedReleaseSlugs()] }, { headers });
  } catch {
    return NextResponse.json({ error: "Deletion state unavailable" }, { status: 503, headers });
  }
}
