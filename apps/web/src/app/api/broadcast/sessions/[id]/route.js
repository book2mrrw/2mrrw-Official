import { NextResponse } from "next/server";
import { authorizeBroadcastListener } from "@/lib/broadcast/server-access";
import { listenerSnapshot } from "@/lib/broadcast/access-policy";
import { BroadcastServiceError } from "@/lib/broadcast/command-service";

export const dynamic = "force-dynamic";
export async function GET(req, { params }) {
  try {
    const { session } = await authorizeBroadcastListener(req, (await params).id);
    return NextResponse.json({ session: listenerSnapshot(session), serverTime: Date.now() }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof BroadcastServiceError ? error.message : "Broadcast unavailable" },
      { status: error instanceof BroadcastServiceError ? error.status : 503, headers: { "Cache-Control": "private, no-store" } });
  }
}
