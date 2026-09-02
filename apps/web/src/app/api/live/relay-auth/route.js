import { NextResponse } from "next/server";
import {
  LIVE_RELAY_PATH,
  verifyLiveRelayPublishToken,
} from "@/lib/server/live-relay-token";

export const dynamic = "force-dynamic";

const MAX_AUTH_BODY_BYTES = 16 * 1024;
const LOOPBACK_ADDRESSES = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

function response(status) {
  return new NextResponse(null, {
    status,
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
}

export async function POST(req) {
  const size = Number(req.headers.get("content-length") || 0);
  if (Number.isFinite(size) && size > MAX_AUTH_BODY_BYTES) return response(413);

  let body;
  try { body = await req.json(); } catch { return response(400); }
  if (body?.path !== LIVE_RELAY_PATH) return response(403);

  // The relay's local FFmpeg process is the only reader. It never exposes a
  // playback endpoint and reads over loopback RTSP solely to forward to Twitch.
  if (
    body.action === "read" &&
    body.protocol === "rtsp" &&
    LOOPBACK_ADDRESSES.has(String(body.ip || ""))
  ) {
    return response(204);
  }

  if (body.action !== "publish" || body.protocol !== "webrtc") return response(403);
  const verified = verifyLiveRelayPublishToken(body.token, { path: body.path });
  return response(verified.ok ? 204 : 403);
}
