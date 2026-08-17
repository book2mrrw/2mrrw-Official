import { after } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { verifyTwitchSignature } from "@/lib/server/twitch-eventsub";
import {
  getCurrentBroadcast,
  scheduleBroadcast,
  setLive,
  sendLivestreamNotifications,
} from "@/lib/server/livestream";

export const dynamic = "force-dynamic";

const TYPE_VERIFICATION = "webhook_callback_verification";
const TYPE_NOTIFICATION = "notification";
const TYPE_REVOCATION   = "revocation";

export async function POST(req) {
  // Read raw body first — HMAC verification needs the exact bytes Twitch sent.
  const rawBody = await req.text();

  if (!verifyTwitchSignature(req.headers, rawBody)) {
    console.warn("[twitch-webhook] signature mismatch — rejected");
    return new Response("Forbidden", { status: 403 });
  }

  let body;
  try { body = JSON.parse(rawBody); }
  catch { return new Response("Bad Request", { status: 400 }); }

  const msgType  = req.headers.get("twitch-eventsub-message-type") || "";
  const eventType = body.subscription?.type;

  // ── Challenge handshake ───────────────────────────────────────────────────
  // Twitch sends this once when a subscription is first registered.
  // Must respond within 10 seconds with the plain-text challenge.
  if (msgType === TYPE_VERIFICATION) {
    return new Response(body.challenge, {
      status:  200,
      headers: { "Content-Type": "text/plain" },
    });
  }

  // ── Revocation notice ─────────────────────────────────────────────────────
  if (msgType === TYPE_REVOCATION) {
    console.info("[twitch-webhook] subscription revoked", eventType, body.subscription?.status);
    return new Response("OK", { status: 200 });
  }

  if (msgType !== TYPE_NOTIFICATION) {
    return new Response("OK", { status: 200 });
  }

  // ── stream.online — 2MRRW went live on Twitch ─────────────────────────────
  if (eventType === "stream.online") {
    after(async () => {
      try {
        const admin     = getAdminClient();
        let broadcast   = await getCurrentBroadcast(admin);

        if (!broadcast) {
          // No scheduled session — create one on the fly.
          broadcast = await scheduleBroadcast(admin, {
            title:      body.event?.title || "2MRRW Live",
            goesLiveAt: new Date().toISOString(),
            channel:    "callme2mrrw",
            audience:   "all",
          });
        }

        // Idempotent — don't double-fire if we're already live.
        if (!broadcast.is_live) {
          const live = await setLive(admin, broadcast.id, true);
          await sendLivestreamNotifications(admin, live, "live");
        }
      } catch (err) {
        console.error("[twitch-webhook] stream.online failed", err?.message);
      }
    });
  }

  // ── stream.offline — stream ended on Twitch ───────────────────────────────
  if (eventType === "stream.offline") {
    after(async () => {
      try {
        const admin     = getAdminClient();
        const broadcast = await getCurrentBroadcast(admin);
        if (broadcast?.is_live) {
          await setLive(admin, broadcast.id, false);
        }
      } catch (err) {
        console.error("[twitch-webhook] stream.offline failed", err?.message);
      }
    });
  }

  // Always acknowledge immediately — Twitch retries if it doesn't get 2xx within 10s.
  return new Response("OK", { status: 200 });
}
