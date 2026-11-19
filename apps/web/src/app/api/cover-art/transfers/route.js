import { NextResponse } from "next/server";
import { laneTransfers } from "@/lib/cover-art/transfers";

export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "private, no-store, max-age=0" };

/**
 * The cover-art worker's storage links (lib/cover-art/transfers.js). Its only
 * credential is the job lease it holds: { id, lease_token, renditions? }.
 */
export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON body required" }, { status: 400, headers });
  }
  try {
    const result = await laneTransfers({ id: body?.id, leaseToken: body?.lease_token, renditions: body?.renditions });
    return NextResponse.json(result.body, { status: result.status, headers });
  } catch (err) {
    console.error("[cover-art/transfers] failed", { message: err?.message });
    return NextResponse.json({ error: "Transfers are temporarily unavailable" }, { status: 503, headers });
  }
}
