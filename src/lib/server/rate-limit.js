import crypto from "crypto";
import { NextResponse } from "next/server";
import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isMissingSupabaseTable } from "@/lib/commerce/entitlements";

// KV is available when Vercel KV env vars are set (linked store in Vercel dashboard).
// Falls back to Supabase when KV is not configured or unavailable.
const KV_ENABLED = Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);

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

async function checkWithKv(kvKey, limit, windowSeconds) {
  const { kv } = await import("@vercel/kv");
  // INCR is atomic — returns the new count after increment.
  const count = await kv.incr(kvKey);
  if (count === 1) {
    // New window — set TTL to 2× the window so the key self-expires.
    await kv.expire(kvKey, windowSeconds * 2);
  }
  return count;
}

async function checkWithSupabase(key, routeKey, identifierHash, windowStart, expiresAt, limit, now) {
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
      return { allowed: true, unavailable: true };
    }
    throw error;
  }

  const row = Array.isArray(data) ? data[0] : data;
  const newCount = row?.new_count ?? 1;
  const allowed = row?.allowed ?? true;
  return { allowed, count: newCount };
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
  const identifierHash = hashIdentifier(identifier || clientIp(req));
  const kvKey = `rl:${routeKey}:${identifierHash}:${windowStartMs}`;

  if (KV_ENABLED) {
    try {
      const count = await checkWithKv(kvKey, limit, windowSeconds);
      if (count > limit) {
        const retryAfterSeconds = Math.max(1, Math.ceil((windowStartMs + windowMs - now) / 1000));
        return { allowed: false, limited: true, retryAfterSeconds };
      }
      return { allowed: true, limited: false, remaining: Math.max(0, limit - count) };
    } catch (err) {
      console.warn("[rate-limit] KV unavailable, falling back to Supabase:", err.message);
      // Fall through to Supabase
    }
  }

  // Supabase fallback (used when KV is not configured or KV threw).
  try {
    const windowStart = new Date(windowStartMs).toISOString();
    const expiresAt = new Date(windowStartMs + windowMs * 2).toISOString();
    const result = await checkWithSupabase(kvKey, routeKey, identifierHash, windowStart, expiresAt, limit, now);

    if (result.unavailable) return { allowed: true, limited: false, unavailable: true };

    if (!result.allowed) {
      const retryAfterSeconds = Math.max(1, Math.ceil((windowStartMs + windowMs - now) / 1000));
      return { allowed: false, limited: true, retryAfterSeconds };
    }

    return { allowed: true, limited: false, remaining: Math.max(0, limit - result.count) };
  } catch (err) {
    console.warn("[rate-limit] Supabase unavailable:", err.message);
    return { allowed: true, limited: false, unavailable: true };
  }
}
