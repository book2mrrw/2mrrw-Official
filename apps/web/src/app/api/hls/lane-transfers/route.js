import { NextResponse } from "next/server";
import { lanePublished, laneTransfers } from "@/lib/hls/lane-transfers";

export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "private, no-store, max-age=0" };

/**
 * The media lanes' storage links and content keys (lib/hls/lane-transfers.js).
 * Their only credential is the job lease they hold: { lane, job_id,
 * worker_id, lease_token, generation, uploads? }; { published: true } after a
 * song's or vault video's commit refreshes its manifest cache.
 */
export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON body required" }, { status: 400, headers });
  }
  try {
    const result = body?.published === true ? await lanePublished(body) : await laneTransfers(body);
    return NextResponse.json(result.body, { status: result.status, headers });
  } catch (err) {
    console.error("[hls/lane-transfers] failed", { lane: body?.lane, message: err?.message });
    return NextResponse.json({ error: "Transfers are temporarily unavailable" }, { status: 503, headers });
  }
}
