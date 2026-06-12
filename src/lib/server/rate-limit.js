import crypto from "crypto";
import { NextResponse } from "next/server";
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
    await admin.from("api_rate_limits").delete().lt("expires_at", new Date(now).toISOString());

    const { data: existing, error: readError } = await admin
      .from("api_rate_limits")
      .select("count")
      .eq("key", key)
      .maybeSingle();

    if (readError) {
      if (isMissingSupabaseTable(readError)) return { allowed: true, limited: false, unavailable: true };
      throw readError;
    }

    const nextCount = (existing?.count || 0) + 1;
    if (nextCount > limit) {
      const retryAfterSeconds = Math.max(1, Math.ceil((windowStartMs + windowMs - now) / 1000));
      return { allowed: false, limited: true, retryAfterSeconds };
    }

    const values = {
      key,
      route_key: routeKey,
      identifier_hash: identifierHash,
      window_start: windowStart,
      expires_at: expiresAt,
      count: nextCount,
    };

    const { error: writeError } = existing
      ? await admin.from("api_rate_limits").update(values).eq("key", key)
      : await admin.from("api_rate_limits").insert(values);

    if (writeError) {
      if (isMissingSupabaseTable(writeError) || writeError.code === "23505") {
        return { allowed: true, limited: false, unavailable: true };
      }
      throw writeError;
    }

    return { allowed: true, limited: false, remaining: Math.max(0, limit - nextCount) };
  } catch (err) {
    console.warn("Rate limit unavailable:", err.message);
    return { allowed: true, limited: false, unavailable: true };
  }
}
