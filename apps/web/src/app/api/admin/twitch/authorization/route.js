import { NextResponse } from "next/server";
import { requireAdminActor } from "@/lib/auth/admin-api-guard";
import { classifyAdminAuthorityDenial } from "@/lib/auth/admin-authority-diagnostics";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import { getAdminClient } from "@/lib/supabase/admin";
import {
  getTwitchAuthorizationStatus,
  pollTwitchDeviceAuthorization,
  revokeTwitchAuthorization,
  startTwitchDeviceAuthorization,
  TwitchAuthorizationPendingError,
} from "@/lib/server/twitch-user-authorization";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "private, no-store, max-age=0" };

function denialResponse(gate) {
  const denial = classifyAdminAuthorityDenial(gate.reason);
  return NextResponse.json(
    { error: denial.status === 401 ? "Unauthorized" : "Admin verification required", code: denial.code },
    { status: denial.status, headers: NO_STORE }
  );
}

async function authorize(req, { recent = false, limit = 30, routeKey }) {
  const gate = await requireAdminActor(recent ? { recentSeconds: 15 * 60 } : undefined);
  if (!gate.ok) return { response: denialResponse(gate) };
  const rate = await checkRateLimit(req, {
    routeKey,
    limit,
    windowSeconds: 60,
    identifier: gate.user.id,
    failureMode: "closed",
  });
  if (rate.limited || rate.allowed === false) return { response: rateLimitResponse(rate.retryAfterSeconds) };
  return { gate };
}

function failure(error, fallback, status = 500) {
  console.error("[admin/twitch/authorization]", error?.message);
  const configuration = /configured|ENCRYPTION_KEY|relation .* does not exist/i.test(String(error?.message || ""));
  return NextResponse.json(
    { error: configuration ? "Twitch authorization is not configured yet" : fallback },
    { status: configuration ? 503 : status, headers: NO_STORE }
  );
}

export async function GET(req) {
  const authority = await authorize(req, { routeKey: "admin.twitch.authorization.status", limit: 60 });
  if (authority.response) return authority.response;
  try {
    return NextResponse.json(await getTwitchAuthorizationStatus(getAdminClient()), { headers: NO_STORE });
  } catch (error) {
    return failure(error, "Could not read Twitch authorization status");
  }
}

export async function POST(req) {
  const authority = await authorize(req, { recent: true, routeKey: "admin.twitch.authorization.start", limit: 10 });
  if (authority.response) return authority.response;
  try {
    const authorization = await startTwitchDeviceAuthorization({ actorId: authority.gate.user.id });
    return NextResponse.json(authorization, { status: 201, headers: NO_STORE });
  } catch (error) {
    return failure(error, "Twitch authorization could not start");
  }
}

export async function PATCH(req) {
  // The short-lived encrypted grant was created behind recent MFA and is bound
  // to this exact admin actor. Polling must not interrupt a Twitch sign-in that
  // legitimately takes longer than the recent-MFA window.
  const authority = await authorize(req, { routeKey: "admin.twitch.authorization.poll", limit: 30 });
  if (authority.response) return authority.response;
  try {
    const body = await req.json();
    const grantToken = String(body?.grantToken || "");
    if (!grantToken || grantToken.length > 4096) {
      return NextResponse.json({ error: "Authorization request is invalid" }, { status: 400, headers: NO_STORE });
    }
    const result = await pollTwitchDeviceAuthorization(getAdminClient(), {
      actorId: authority.gate.user.id,
      grantToken,
    });
    return NextResponse.json({ connected: true, authorization: result }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof TwitchAuthorizationPendingError) {
      return NextResponse.json(
        { pending: true, slowDown: error.code === "slow_down" },
        { status: 202, headers: NO_STORE }
      );
    }
    const badGrant = /request (?:is invalid|expired)/i.test(String(error?.message || ""));
    return failure(error, badGrant ? error.message : "Twitch authorization failed", badGrant ? 400 : 502);
  }
}

export async function DELETE(req) {
  const authority = await authorize(req, { recent: true, routeKey: "admin.twitch.authorization.revoke", limit: 10 });
  if (authority.response) return authority.response;
  try {
    await revokeTwitchAuthorization(getAdminClient());
    return NextResponse.json({ ok: true, connected: false }, { headers: NO_STORE });
  } catch (error) {
    return failure(error, "Twitch authorization could not be removed");
  }
}
