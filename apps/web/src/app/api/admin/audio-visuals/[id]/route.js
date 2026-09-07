/**
 * PATCH /api/admin/audio-visuals/[id]
 *
 * Deliberately minimal — sets `price_cents` only. A full edit view
 * (title, credits, genre, etc.) stays explicitly deferred, matching
 * InlineAudioVisualzManager.js's own scope note. This exists because every
 * video created before pricing existed in the upload form is otherwise
 * permanently stuck at price_cents=0, which create-payment-intent correctly
 * rejects as an invalid purchase amount — there was no way to ever fix that.
 */
import { NextResponse } from "next/server";
import { getAdminSessionUser } from "@/lib/auth/admin-api-guard";
import { isAdminUser } from "@/lib/auth/constants";
import { getAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

export async function PATCH(req, { params }) {
  const { id } = await params;
  const user = await getAdminSessionUser();
  if (!user || !isAdminUser(user)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = await checkRateLimit(req, {
    routeKey: "admin.audio-visuals.patch",
    limit: 30,
    windowSeconds: 60,
    identifier: user.id,
  });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterSeconds);

  let body;
  try { body = await req.json(); } catch { body = {}; }

  const { price_cents: priceCents } = body;
  if (!Number.isInteger(priceCents) || priceCents < 0) {
    return NextResponse.json({ error: "price_cents must be a non-negative integer" }, { status: 400 });
  }

  const admin = getAdminClient();
  const { data, error } = await admin
    .from("audio_visuals")
    .update({ price_cents: priceCents })
    .eq("id", id)
    .select("id, price_cents")
    .maybeSingle();

  if (error) {
    console.error("[admin/audio-visuals/[id]] price update error", error.message);
    return NextResponse.json({ error: "Failed to update price" }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Video not found" }, { status: 404 });
  }

  return NextResponse.json({ id: data.id, price_cents: data.price_cents });
}
