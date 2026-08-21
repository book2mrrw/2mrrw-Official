import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getFanSessionUser } from "@/lib/auth/session-user";
import { isAdminUser } from "@/lib/auth/constants";
import { getAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

// ── GET /api/admin/releases/[id] ─────────────────────────────────────────────────
// Returns full release detail needed by the inline editor:
// release metadata (title from products, price_cents, genre, release_date)
// + tracks with id, slug, title, position, lyrics, upload_status
export async function GET(req, { params }) {
  const user = await getFanSessionUser();
  if (!user || !isAdminUser(user)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = await checkRateLimit(req, {
    routeKey: "admin.releases.detail",
    limit: 120,
    windowSeconds: 60,
    identifier: user.id,
  });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterSeconds);

  const { id } = params;
  if (!id) return NextResponse.json({ error: "Release ID required" }, { status: 400 });

  const admin = getAdminClient();

  const [releaseRes, productRes, tracksRes] = await Promise.all([
    admin
      .from("releases")
      .select("id, slug, status, release_type, release_date, scheduled_at, storefront_visible, cover_art_r2_key, upc, created_at")
      .eq("id", id)
      .single(),
    admin
      .from("products")
      .select("title, display_title, price_cents, metadata")
      .eq("release_id", id)
      .maybeSingle(),
    admin
      .from("tracks")
      .select("id, slug, title, position, lyrics, upload_status, audio_r2_key")
      .eq("release_id", id)
      .order("position", { ascending: true }),
  ]);

  if (releaseRes.error || !releaseRes.data) {
    return NextResponse.json({ error: "Release not found" }, { status: 404 });
  }

  const release = releaseRes.data;
  const product = productRes.data;
  const tracks  = tracksRes.data || [];

  return NextResponse.json({
    release: {
      id:                release.id,
      slug:              release.slug,
      status:            release.status,
      release_type:      release.release_type,
      release_date:      release.release_date,
      scheduled_at:      release.scheduled_at,
      storefront_visible: release.storefront_visible,
      cover_art_r2_key:  release.cover_art_r2_key,
    },
    product: {
      title:       product?.title       || null,
      display_title: product?.display_title || null,
      price_cents: product?.price_cents  || null,
      genre:       product?.metadata?.genre || null,
    },
    tracks: tracks.map((t) => ({
      id:            t.id,
      slug:          t.slug,
      title:         t.title || "",
      position:      t.position,
      lyrics:        t.lyrics || "",
      upload_status: t.upload_status,
      has_audio:     Boolean(t.audio_r2_key),
    })),
  });
}

// ── PATCH /api/admin/releases/[id] ───────────────────────────────────────────────
// Body: { title?, price?, genre?, release_date?, track_lyrics? [{id, lyrics}] }
// Updates products + releases + track lyrics.
export async function PATCH(req, { params }) {
  const user = await getFanSessionUser();
  if (!user || !isAdminUser(user)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = await checkRateLimit(req, {
    routeKey: "admin.releases.patch",
    limit: 30,
    windowSeconds: 60,
    identifier: user.id,
  });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterSeconds);

  const { id } = params;
  if (!id) return NextResponse.json({ error: "Release ID required" }, { status: 400 });

  let body;
  try { body = await req.json(); } catch { body = {}; }

  const { title, price, genre, release_date, track_lyrics } = body;

  const admin = getAdminClient();

  // Verify release exists and belongs to us
  const { data: release, error: relErr } = await admin
    .from("releases")
    .select("id, slug, release_type")
    .eq("id", id)
    .single();

  if (relErr || !release) {
    return NextResponse.json({ error: "Release not found" }, { status: 404 });
  }

  const errors = [];

  // Update release_date on releases table
  if (release_date !== undefined) {
    const { error } = await admin
      .from("releases")
      .update({ release_date })
      .eq("id", id);
    if (error) errors.push(`releases.release_date: ${error.message}`);
  }

  // Update products: title, price_cents, genre (via metadata)
  if (title !== undefined || price !== undefined || genre !== undefined) {
    // Fetch current product metadata to merge genre
    const { data: currentProduct } = await admin
      .from("products")
      .select("metadata, price_cents")
      .eq("release_id", id)
      .maybeSingle();

    const updates = {};

    if (title !== undefined) {
      updates.title         = title;
      updates.display_title = title;
    }

    if (price !== undefined && price !== "") {
      const priceCents = Math.round(parseFloat(price) * 100);
      if (!isNaN(priceCents) && priceCents > 0) {
        updates.price_cents = priceCents;
      }
    }

    if (genre !== undefined) {
      const currentMeta = currentProduct?.metadata || {};
      updates.metadata = { ...currentMeta, genre };
    }

    if (Object.keys(updates).length > 0) {
      const { error } = await admin
        .from("products")
        .update(updates)
        .eq("release_id", id);
      if (error) errors.push(`products: ${error.message}`);
    }
  }

  // Update per-track lyrics
  if (Array.isArray(track_lyrics) && track_lyrics.length > 0) {
    for (const { id: trackId, lyrics } of track_lyrics) {
      if (!trackId) continue;
      const { error } = await admin
        .from("tracks")
        .update({ lyrics: lyrics || "" })
        .eq("id", trackId)
        .eq("release_id", id); // guard: only update tracks that belong to this release
      if (error) errors.push(`track ${trackId}: ${error.message}`);
    }
  }

  if (errors.length > 0) {
    console.error("[releases PATCH] partial errors", errors);
    return NextResponse.json({ ok: false, errors }, { status: 207 });
  }

  // Propagate changes to ISR-cached storefront and release pages
  try {
    revalidatePath("/");
    revalidatePath("/song/[slug]", "page");
    revalidatePath("/feature/[slug]", "page");
    revalidatePath("/album/[slug]", "page");
  } catch {}

  return NextResponse.json({ ok: true });
}
