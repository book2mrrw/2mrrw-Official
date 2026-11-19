import { NextResponse } from "next/server";
import { applyMediaCors, mediaCorsPreflightResponse } from "@/lib/server/media-cors";
import { getAdminClient } from "@/lib/supabase/admin";
import { getFanSessionUser } from "@/lib/auth/session-user";
import { isMissingSupabaseTable } from "@/lib/commerce/entitlements";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import {
  MAX_EVENTS_PER_REQUEST,
  buildPlaybackEventRow,
  cleanSlug,
  geoFromHeaders,
  isPreV1SchemaError,
  rateLimitIdentity,
} from "@/lib/analytics/playback-events";

export const dynamic = "force-dynamic";

export async function OPTIONS(req) {
  return mediaCorsPreflightResponse(req);
}

async function sessionUser() {
  try {
    return await getFanSessionUser();
  } catch {
    return null;
  }
}

/**
 * Owning release's product row, so per-track analytics can tell apart
 * catalog_tracks.slug values that are only unique within their own album.
 * Prefers albumSlug (multi-track release) over the bare slug (single).
 * Best-effort: a miss or an error leaves product_id null.
 */
async function resolveProductId(admin, body, cache) {
  const albumSlug = cleanSlug(body.albumSlug);
  const slug = cleanSlug(body.slug);
  const key = albumSlug || slug;
  if (cache.has(key)) return cache.get(key);
  let productId;
  try {
    const { data: productRow } = await admin
      .from("products")
      .select("id")
      .eq("slug", albumSlug || slug)
      .maybeSingle();
    productId = productRow?.id || null;
  } catch {
    productId = null;
  }
  cache.set(key, productId);
  return productId;
}

/**
 * Store events. With the v1 migration applied: idempotent on event_id, so a
 * retried or replayed event (offline outbox) is stored once. Before it: the
 * same rows trimmed to the legacy columns, so nothing is lost meanwhile.
 */
async function storeRows(admin, built) {
  const rows = built.map((b) => b.row);
  const v1 = await admin
    .from("media_stream_events")
    .upsert(rows, { onConflict: "event_id", ignoreDuplicates: true });
  if (!v1.error) return { error: null, schema: "v1" };
  if (!isPreV1SchemaError(v1.error)) return { error: v1.error, schema: "v1" };
  const legacyRows = built.map((b) => b.legacyRow).filter(Boolean);
  if (!legacyRows.length) return { error: null, schema: "legacy" };
  const legacy = await admin.from("media_stream_events").insert(legacyRows);
  return { error: legacy.error, schema: "legacy" };
}

/**
 * Cross-device resume position. Unchanged behavior: kept for legacy guest
 * sessions only, exactly as before analytics identity was fixed.
 */
async function upsertResumePosition(admin, user, body, eventType) {
  if (!user?.id || !user.isGuest) return null;
  const slug = cleanSlug(body.slug);
  const mediaType = body.mediaType || "audio";
  const completed = eventType === "complete";
  const { data: existing } = await admin
    .from("media_playback_progress")
    .select("replay_count")
    .eq("user_id", user.id)
    .eq("product_slug", slug)
    .eq("media_type", mediaType)
    .maybeSingle();
  const { error } = await admin
    .from("media_playback_progress")
    .upsert(
      {
        user_id: user.id,
        product_slug: slug,
        media_type: mediaType,
        position_seconds: completed ? 0 : Math.max(0, Math.floor(Number(body.positionSeconds) || 0)),
        duration_seconds: Math.max(0, Math.floor(Number(body.durationSeconds) || 0)),
        completed,
        replay_count: completed ? (existing?.replay_count || 0) + 1 : (existing?.replay_count || 0),
        last_played_at: new Date().toISOString(),
        device_label: body.deviceLabel || "web",
        metadata: { title: body.title || null },
      },
      { onConflict: "user_id,product_slug,media_type" }
    );
  return error && !isMissingSupabaseTable(error) ? error : null;
}

export async function POST(req) {
  try {
    const user = await sessionUser();
    const body = await req.json();
    const isBatch = Array.isArray(body?.events);
    const events = (isBatch ? body.events : [body]).slice(0, MAX_EVENTS_PER_REQUEST)
      .filter((e) => e && typeof e === "object" && cleanSlug(e.slug));

    if (!events.length) {
      return applyMediaCors(req, NextResponse.json({ error: "slug required" }, { status: 400 }));
    }

    // One bucket per listener (signed-in user, else client IP) — never per song.
    const limit = await checkRateLimit(req, {
      routeKey: "media-playback",
      limit: 240,
      windowSeconds: 300,
      identifier: rateLimitIdentity(user),
    });
    if (!limit.allowed) return applyMediaCors(req, rateLimitResponse(limit.retryAfterSeconds));

    const admin = getAdminClient();
    const geo = geoFromHeaders(req.headers);
    const productIds = new Map();
    const built = [];
    for (const event of events) {
      // Position sync keeps the resume point; it is not a listening event.
      if (event.positionSync === true) continue;
      const productId = await resolveProductId(admin, event, productIds);
      built.push(buildPlaybackEventRow({ body: event, user, geo, productId }));
    }

    let schema = null;
    if (built.length) {
      const stored = await storeRows(admin, built);
      schema = stored.schema;
      if (stored.error) {
        if (isMissingSupabaseTable(stored.error)) {
          return applyMediaCors(req, NextResponse.json({ persisted: false, reason: "media analytics tables missing" }));
        }
        throw stored.error;
      }
    }

    if (!isBatch) {
      const eventType = built[0]?.row.event_type || "progress";
      const progressError = await upsertResumePosition(admin, user, events[0], eventType);
      if (progressError) throw progressError;
    }

    return applyMediaCors(req, NextResponse.json({ persisted: true, stored: built.length, schema }));
  } catch (err) {
    console.error("media playback persistence error:", err);
    return applyMediaCors(
      req,
      NextResponse.json({ error: err.message || "Playback persistence failed" }, { status: 500 })
    );
  }
}
