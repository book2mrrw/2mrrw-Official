import { after } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { isFreshTwitchMessage, verifyTwitchSignature } from "@/lib/server/twitch-eventsub";
import {
  persistTwitchEventNotification,
  processTwitchEventReceipt,
} from "@/lib/server/twitch-livestream-authority";

export const dynamic = "force-dynamic";

const TYPE_VERIFICATION = "webhook_callback_verification";
const TYPE_NOTIFICATION = "notification";
const TYPE_REVOCATION = "revocation";

export async function POST(req) {
  const rawBody = await req.text();

  if (!verifyTwitchSignature(req.headers, rawBody)) {
    console.warn("[twitch-webhook] signature mismatch — rejected");
    return new Response("Forbidden", { status: 403 });
  }
  if (!isFreshTwitchMessage(req.headers)) {
    console.warn("[twitch-webhook] stale or invalid timestamp — rejected");
    return new Response("Forbidden", { status: 403 });
  }

  let body;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  const msgType = req.headers.get("twitch-eventsub-message-type") || "";
  const eventType = body.subscription?.type;

  if (msgType === TYPE_VERIFICATION) {
    if (typeof body.challenge !== "string") return new Response("Bad Request", { status: 400 });
    return new Response(body.challenge, {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }

  if (msgType !== TYPE_NOTIFICATION && msgType !== TYPE_REVOCATION) {
    return new Response("OK", { status: 200 });
  }
  if (msgType === TYPE_REVOCATION) {
    console.warn("[twitch-webhook] subscription revoked", eventType, body.subscription?.status);
  }

  const admin = getAdminClient();
  let receipt;
  try {
    receipt = await persistTwitchEventNotification(admin, req.headers, body);
  } catch (error) {
    console.error("[twitch-webhook] durable receipt failed", error?.message);
    return new Response("Service Unavailable", { status: 503 });
  }

  if (!receipt.duplicate) {
    after(async () => {
      try {
        await processTwitchEventReceipt(getAdminClient(), receipt.messageId);
      } catch (error) {
        console.error("[twitch-webhook] durable processing deferred", error?.message);
      }
    });
  }

  return new Response("OK", { status: 200 });
}
