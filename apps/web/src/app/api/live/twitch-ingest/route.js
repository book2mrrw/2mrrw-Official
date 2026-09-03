import { NextResponse } from "next/server";
import { requireServiceCapability, ServiceCapability } from "@/lib/auth/admin-api-guard";
import {
  getAuthorizedTwitchStreamKey,
  TwitchAuthorizationRequiredError,
} from "@/lib/server/twitch-user-authorization";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "private, no-store, max-age=0" };
const TWITCH_INGEST_ORIGIN = "rtmps://ingest.global-contribute.live-video.net/app";

export async function POST(req) {
  const service = requireServiceCapability(req, ServiceCapability.LIVE_TWITCH_INGEST);
  if (!service.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
  }
  try {
    const streamKey = await getAuthorizedTwitchStreamKey();
    return NextResponse.json(
      { destination: `${TWITCH_INGEST_ORIGIN}/${streamKey}` },
      { headers: NO_STORE }
    );
  } catch (error) {
    console.error("[live/twitch-ingest]", error?.message);
    const needsAuthorization = error instanceof TwitchAuthorizationRequiredError;
    return NextResponse.json(
      { error: needsAuthorization ? "Authorize Twitch in the Broadcast Studio" : "Twitch ingest is unavailable" },
      { status: needsAuthorization ? 409 : 502, headers: NO_STORE }
    );
  }
}
