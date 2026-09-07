/**
 * POST /api/admin/audio-visual/seriez
 * GET  /api/admin/audio-visual/seriez
 *
 * Creates (or lists) audio_visual_seriez containers — the episodic wrapper
 * any content type can optionally attach to (see audio_visual/draft/route.js).
 * Slug generation mirrors that same route's own logic exactly (title →
 * slugify → dedup loop → random fallback), scoped to audio_visual_seriez's
 * own slug uniqueness rather than audio_visuals'.
 *
 * Creating a Seriez with no episodes yet is a normal, supported state ("just
 * set up a theme") — this route never requires an episode to exist.
 */
import { NextResponse } from "next/server";
import { getAdminSessionUser } from "@/lib/auth/admin-api-guard";
import { isAdminUser } from "@/lib/auth/constants";
import { getAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

const SLUG_RE = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/;

function slugify(str) {
  return String(str || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export async function GET(req) {
  const user = await getAdminSessionUser();
  if (!user || !isAdminUser(user)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = await checkRateLimit(req, {
    routeKey: "admin.audio-visual.seriez.list",
    limit: 60,
    windowSeconds: 60,
    identifier: user.id,
  });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterSeconds);

  const admin = getAdminClient();
  const { data, error } = await admin
    .from("audio_visual_seriez")
    .select("id, slug, title, created_at")
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    console.error("[admin/audio-visual/seriez] list error", error.message);
    return NextResponse.json({ error: "Failed to list Seriez" }, { status: 500 });
  }

  return NextResponse.json({ seriez: data || [] });
}

export async function POST(req) {
  const user = await getAdminSessionUser();
  if (!user || !isAdminUser(user)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = await checkRateLimit(req, {
    routeKey: "admin.audio-visual.seriez.create",
    limit: 20,
    windowSeconds: 300,
    identifier: user.id,
  });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterSeconds);

  let body;
  try { body = await req.json(); } catch { body = {}; }

  const { title, description } = body;
  if (!title || typeof title !== "string" || !title.trim()) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }

  const admin = getAdminClient();
  const baseSlugCandidate = slugify(title);

  let slug;
  if (baseSlugCandidate && SLUG_RE.test(baseSlugCandidate)) {
    let candidate = baseSlugCandidate;
    for (let attempt = 1; attempt <= 10; attempt++) {
      const { data: existing } = await admin.from("audio_visual_seriez").select("id").eq("slug", candidate).maybeSingle();
      if (!existing) { slug = candidate; break; }
      candidate = `${baseSlugCandidate}-${attempt + 1}`;
    }
  }
  if (!slug) {
    slug = `seriez-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  const { data, error } = await admin
    .from("audio_visual_seriez")
    .insert({ title: title.trim(), description: description || null, slug })
    .select("id, slug, title")
    .single();

  if (error) {
    console.error("[admin/audio-visual/seriez] insert error", error.message);
    return NextResponse.json({ error: "Failed to create Seriez" }, { status: 500 });
  }

  return NextResponse.json({ seriez_id: data.id, slug: data.slug, title: data.title });
}
