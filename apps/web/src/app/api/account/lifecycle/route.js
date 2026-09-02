import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { getFanSessionUser } from "@/lib/auth/session-user";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { isSchemaUnavailableError } from "@/lib/commerce/entitlements";
import { emitServerEvent } from "@/lib/observability/server-events";

function json(body, status = 200, correlationId) {
  return NextResponse.json(body, {
    status,
    headers: correlationId ? { "X-Correlation-ID": correlationId } : undefined,
  });
}

// A missing table (42P01) is covered by isSchemaUnavailableError; a missing
// RPC function (42883) is a distinct Postgres error code for the same
// underlying problem — this route calls two RPCs, so check for it explicitly
// too, rather than only ever surfacing "Could not create account request" /
// "Deletion request cannot be cancelled" for what's actually a deploy gap.
function isMissingRpcFunction(error) {
  return error?.code === "42883";
}

function isSchemaUnavailable(error) {
  return isSchemaUnavailableError(error) || isMissingRpcFunction(error);
}

function unavailableResponse(correlationId, error, context) {
  emitServerEvent("error", "account_lifecycle_schema_unavailable", { correlationId, context }, error);
  return json(
    { error: "Account requests are temporarily unavailable. Please try again shortly or contact support." },
    503,
    correlationId
  );
}

async function registeredUser() {
  const user = await getFanSessionUser();
  return user && user.isGuest !== true ? user : null;
}

export async function GET() {
  const correlationId = crypto.randomUUID();
  const user = await registeredUser();
  if (!user) return json({ error: "Authentication required" }, 401, correlationId);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("account_lifecycle_requests")
    .select("id,kind,status,requested_at,execute_after,cancelled_at,completed_at,failure_code")
    .eq("user_id", user.id)
    .order("requested_at", { ascending: false })
    .limit(20);
  if (error) {
    if (isSchemaUnavailable(error)) return unavailableResponse(correlationId, error, "GET");
    return json({ error: "Could not load account requests" }, 500, correlationId);
  }
  return json({ requests: data || [] }, 200, correlationId);
}

export async function POST(req) {
  const correlationId = req.headers.get("x-correlation-id") || crypto.randomUUID();
  const user = await registeredUser();
  if (!user) return json({ error: "Authentication required" }, 401, correlationId);
  const limit = await checkRateLimit(req, {
    routeKey: "account.lifecycle.request",
    limit: 3,
    windowSeconds: 3600,
    identifier: user.id,
    failureMode: "closed",
  });
  if (!limit.allowed) {
    return limit.unavailable
      ? json({ error: "Account requests are temporarily unavailable" }, 503, correlationId)
      : rateLimitResponse(limit.retryAfterSeconds);
  }
  const body = await req.json().catch(() => null);
  const kind = body?.kind;
  const idempotencyKey = body?.idempotencyKey;
  if (!['export', 'delete'].includes(kind) || !/^[0-9a-f-]{36}$/i.test(idempotencyKey || "")) {
    return json({ error: "kind and UUID idempotencyKey are required" }, 400, correlationId);
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("request_account_lifecycle", {
    p_kind: kind,
    p_idempotency_key: idempotencyKey,
    p_correlation_id: correlationId,
  });
  if (error) {
    if (isSchemaUnavailable(error)) return unavailableResponse(correlationId, error, "POST");
    return json({ error: "Could not create account request" }, 409, correlationId);
  }
  return json({ request: data }, 202, correlationId);
}

export async function DELETE(req) {
  const correlationId = req.headers.get("x-correlation-id") || crypto.randomUUID();
  const user = await registeredUser();
  if (!user) return json({ error: "Authentication required" }, 401, correlationId);
  const requestId = req.nextUrl.searchParams.get("requestId") || "";
  if (!/^[0-9a-f-]{36}$/i.test(requestId)) return json({ error: "Valid requestId required" }, 400, correlationId);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("cancel_account_deletion", {
    p_request_id: requestId,
    p_correlation_id: correlationId,
  });
  if (error) {
    if (isSchemaUnavailable(error)) return unavailableResponse(correlationId, error, "DELETE");
    return json({ error: "Deletion request cannot be cancelled" }, 409, correlationId);
  }
  if (data !== true) return json({ error: "Deletion request cannot be cancelled" }, 409, correlationId);
  return json({ ok: true }, 200, correlationId);
}
