import { NextResponse } from "next/server";
import { applyMediaCors, mediaCorsPreflightResponse } from "@/lib/server/media-cors";
import { createAdminClient } from "@/lib/supabase/admin";
import { getGuestUser } from "@/lib/guest-session";
import { isMissingSupabaseTable } from "@/lib/commerce/entitlements";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

export async function OPTIONS(req) {
  return mediaCorsPreflightResponse(req);
}

function cleanSlug(value) {
  return String(value || "").trim().slice(0, 160);
}

function cleanEventType(value) {
  return ["play", "progress", "complete", "replay", "save"].includes(value) ? value : "progress";
}

export async function POST(req) {
  try {
    const user = await getGuestUser();
    const body = await req.json();
    const slug = cleanSlug(body.slug);

    if (!slug) {
      return applyMediaCors(req, NextResponse.json({ error: "slug required" }, { status: 400 }));
    }

    const limit = await checkRateLimit(req, {
      routeKey: "media-playback",
      limit: 120,
      windowSeconds: 300,
      identifier: user?.id || slug,
    });
    if (!limit.allowed) return applyMediaCors(req, rateLimitResponse(limit.retryAfterSeconds));

    const admin = createAdminClient();
    const eventType = cleanEventType(body.eventType);
    const positionSeconds = Math.max(0, Math.floor(Number(body.positionSeconds) || 0));
    const durationSeconds = Math.max(0, Math.floor(Number(body.durationSeconds) || 0));
    const completed = eventType === "complete" || Boolean(body.completed);
    const completionRate = durationSeconds > 0
      ? Math.max(0, Math.min(1, positionSeconds / durationSeconds))
      : null;

    const eventPayload = {
      user_id: user?.id || null,
      product_slug: slug,
      event_type: completed ? "complete" : eventType,
      media_type: body.mediaType || "audio",
      position_seconds: positionSeconds,
      duration_seconds: durationSeconds,
      completion_rate: completionRate,
      metadata: {
        title: body.title || null,
        source: body.source || "web-player",
      },
    };

    const { error: eventError } = await admin.from("media_stream_events").insert(eventPayload);
    if (eventError) {
      if (isMissingSupabaseTable(eventError)) {
        return applyMediaCors(
          req,
          NextResponse.json({ persisted: false, reason: "media analytics tables missing" })
        );
      }
      throw eventError;
    }

    if (user?.id) {
      const { data: existing } = await admin
        .from("media_playback_progress")
        .select("replay_count")
        .eq("user_id", user.id)
        .eq("product_slug", slug)
        .eq("media_type", body.mediaType || "audio")
        .maybeSingle();

      const { error: progressError } = await admin
        .from("media_playback_progress")
        .upsert(
          {
            user_id: user.id,
            product_slug: slug,
            media_type: body.mediaType || "audio",
            position_seconds: completed ? 0 : positionSeconds,
            duration_seconds: durationSeconds,
            completed,
            replay_count: completed ? (existing?.replay_count || 0) + 1 : (existing?.replay_count || 0),
            last_played_at: new Date().toISOString(),
            device_label: body.deviceLabel || "web",
            metadata: { title: body.title || null },
          },
          { onConflict: "user_id,product_slug,media_type" }
        );
      if (progressError && !isMissingSupabaseTable(progressError)) throw progressError;
    }

    return applyMediaCors(req, NextResponse.json({ persisted: true }));
  } catch (err) {
    console.error("media playback persistence error:", err);
    return applyMediaCors(
      req,
      NextResponse.json({ error: err.message || "Playback persistence failed" }, { status: 500 })
    );
  }
}
