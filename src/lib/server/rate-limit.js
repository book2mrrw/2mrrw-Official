import crypto from "crypto";
import { NextResponse } from "next/server";
import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isMissingSupabaseTable } from "@/lib/commerce/entitlements";

function clientIp(req) {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "unknown";
}

function hashIdentifier(value) {
  return crypto.createHash("sha256").update(String(value || "unknown")).digest("hex");
}

export function rateLimitResponse(retryAfterSeconds = 60) {
  return NextResponse.json(
    { error: "Too many requests. Please try again shortly." },
    {
      status: 429,
      headers: {
        "Retry-After": String(retryAfterSeconds),
      },
    }
  );
}

export async function checkRateLimit(req, {
  routeKey,
  limit = 20,
  windowSeconds = 60,
  identifier,
}) {
  const now = Date.now();
  const windowMs = windowSeconds * 1000;
  const windowStartMs = Math.floor(now / windowMs) * windowMs;
  const windowStart = new Date(windowStartMs).toISOString();
  const expiresAt = new Date(windowStartMs + windowMs * 2).toISOString();
  const identifierHash = hashIdentifier(identifier || clientIp(req));
  const key = `${routeKey}:${identifierHash}:${windowStartMs}`;

  try {
    const admin = createAdminClient();
    // Defer expired-row cleanup so it never blocks the response.
    after(() => {
      admin.from("api_rate_limits").delete().lt("expires_at", new Date(now).toISOString()).then(() => {}).catch(() => {});
    });

    const { data, error } = await admin.rpc("increment_rate_limit", {
      p_key: key,
      p_route_key: routeKey,
      p_id_hash: identifierHash,
      p_window_start: windowStart,
      p_expires_at: expiresAt,
      p_limit: limit,
    });

    if (error) {
      if (isMissingSupabaseTable(error) || error.code === "42883") {
        // Table or RPC missing — fail open.
        return { allowed: true, limited: false, unavailable: true };
      }
      throw error;
    }

    const row = Array.isArray(data) ? data[0] : data;
    const newCount = row?.new_count ?? 1;
    const allowed = row?.allowed ?? true;

    if (!allowed) {
      const retryAfterSeconds = Math.max(1, Math.ceil((windowStartMs + windowMs - now) / 1000));
      return { allowed: false, limited: true, retryAfterSeconds };
    }

    return { allowed: true, limited: false, remaining: Math.max(0, limit - newCount) };
  } catch (err) {
    console.warn("Rate limit unavailable:", err.message);
    return { allowed: true, limited: false, unavailable: true };
  }
}
