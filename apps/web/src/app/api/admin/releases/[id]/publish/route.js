import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getFanSessionUser } from "@/lib/auth/session-user";
import { isAdminUser } from "@/lib/auth/constants";
import { getAdminClient } from "@/lib/supabase/admin";
import { headR2ObjectKey } from "@/lib/storage/r2";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import {
  resolveStoragePath,
  resolvePreviewPath,
  resolveArtworkPath,
  resolveVideoPath,
  visualDiscoveryUrl,
  previewDiscoveryUrl,
} from "@/lib/media/canonical-paths";
import { normalizeReleaseType } from "@/lib/media/utils/normalize-release-type";

export const dynamic = "force-dynamic";

const RELEASE_TYPE_FOLDERS = {
  single:  "singles",
  feature: "features",
  album:   "albums",
  ep:      "mixtapes-and-eps",
  mixtape: "mixtapes-and-eps",
};

const PRODUCT_TYPE_MAP = {
  single:  "single",
  feature: "feature",
  album:   "album",
  ep:      "album",
  mixtape: "album",
};

function slugify(title) {
  return String(title || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || `release-${Date.now()}`;
}

export async function POST(req, { params }) {
  const user = await getFanSessionUser();
  if (!user || !isAdminUser(user)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = await checkRateLimit(req, {
    routeKey: "admin.releases.publish",
    limit: 10,
    windowSeconds: 120,
    identifier: user.id,
  });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterSeconds);

  const { id: releaseId } = params;
  if (!releaseId) return NextResponse.json({ error: "Release ID required" }, { status: 400 });

  let body;
  try { body = await req.json(); } catch { body = {}; }

  // All wizard-collected data comes from the request body
  const {
    title,
    price,             // string "$2.99" or number
    price_cents,       // number override
    release_date,
    genre,
    content_rating,
    featured_artists = [],
    produced_by = [],
    written_by = [],
    mixing_engineer,
    mastering_engineer,
    executive_producer,
    isrc,
    upc,
    copyright_year,
    c_line,
    p_line,
    publishing_credits,
    cover_key,         // R2 key set by /upload/complete
    audio_key,         // R2 key set by /upload/complete
    track_id,          // tracks row id (single/feature only)
    lyrics,
    scheduled_at,
    tracks: bodyTracks = [],  // per-track overrides from wizard (multi-track)
  } = body;

  const admin = getAdminClient();

  // ── 1. Load the release record ─────────────────────────────────────────────
  const { data: release, error: relErr } = await admin
    .from("releases")
    .select("id, slug, status, release_type, cover_art_r2_key")
    .eq("id", releaseId)
    .single();

  if (relErr || !release) {
    return NextResponse.json({ error: "Release not found" }, { status: 404 });
  }
  if (release.status === "published") {
    return NextResponse.json({ error: "Release is already published" }, { status: 409 });
  }

  const releaseType = release.release_type;
  const typeFolder  = RELEASE_TYPE_FOLDERS[releaseType] || "singles";
  const isMultiTrack = ["album", "ep", "mixtape"].includes(releaseType);

  // ── 2. Load tracks ─────────────────────────────────────────────────────────
  const { data: dbTracks } = await admin
    .from("tracks")
    .select("id, slug, title, upload_status, audio_r2_key, position, lyrics")
    .eq("release_id", releaseId);

  // Merge body track data (titles, lyrics, credits overrides) into DB rows
  const tracks = (dbTracks || []).map((dbTrack) => {
    const bodyTrack = bodyTracks.find((bt) => bt.id === dbTrack.id || bt.slug === dbTrack.slug);
    if (!bodyTrack) return dbTrack;
    return {
      ...dbTrack,
      title:            bodyTrack.title    || dbTrack.title,
      position:         bodyTrack.position ?? dbTrack.position,
      lyrics:           bodyTrack.lyrics   || dbTrack.lyrics,
      featured_artists: bodyTrack.featured_artists !== undefined ? bodyTrack.featured_artists : null,
      track_credits: {
        produced_by:    bodyTrack.produced_by    ?? null,
        written_by:     bodyTrack.written_by     ?? null,
        isrc:           bodyTrack.isrc           || null,
        content_rating: bodyTrack.content_rating || null,
      },
    };
  });

  // ── 3. VALIDATING — blocking checks ───────────────────────────────────────
  if (!title?.trim()) {
    return NextResponse.json({ error: "BLOCKING: Release title is required" }, { status: 422 });
  }

  // Cover: prefer body-supplied key, fall back to what's stored on the release row
  const resolvedCoverKey = cover_key || release.cover_art_r2_key;
  if (!resolvedCoverKey) {
    return NextResponse.json({ error: "BLOCKING: Cover artwork must be uploaded before publishing" }, { status: 422 });
  }

  let coverExists = false;
  try { coverExists = await headR2ObjectKey(resolvedCoverKey); } catch {}
  if (!coverExists) {
    return NextResponse.json({ error: "BLOCKING: Cover artwork not found in storage — please re-upload" }, { status: 422 });
  }

  const readyTracks = (tracks || []).filter((t) => t.audio_r2_key && t.upload_status === "ready");

  // For singles/features, also accept audio_key from the body (wizard state)
  const hasAudioFromBody = Boolean(audio_key);
  const hasAudioFromDB   = readyTracks.length > 0;

  if (!isMultiTrack && !hasAudioFromBody && !hasAudioFromDB) {
    return NextResponse.json({ error: "BLOCKING: Audio master must be uploaded before publishing" }, { status: 422 });
  }
  if (isMultiTrack && !hasAudioFromDB) {
    return NextResponse.json({ error: "BLOCKING: At least one track must have audio uploaded" }, { status: 422 });
  }

  // ── 4. Resolve final status (needed for product active flag) ──────────────
  const newStatus = scheduled_at ? "scheduled" : "published";

  // ── 5. Build canonical slug ────────────────────────────────────────────────
  const existingSlug = release.slug;
  const releaseSlug = (!existingSlug || existingSlug.startsWith("draft-"))
    ? slugify(title)
    : existingSlug;

  // ── 6. Build storefront media paths ───────────────────────────────────────
  const storage_path = resolveStoragePath(typeFolder, releaseSlug);
  const artwork_path = resolveArtworkPath(typeFolder, releaseSlug);
  const preview_path = resolvePreviewPath(typeFolder, releaseSlug);
  const video_path   = resolveVideoPath(typeFolder, releaseSlug);
  const visual       = visualDiscoveryUrl(typeFolder, releaseSlug, {});
  const preview      = previewDiscoveryUrl(preview_path);

  // Price: body price_cents takes priority, then parse price string, then defaults
  const resolvedPriceCents = price_cents
    || (price ? Math.round(parseFloat(String(price).replace(/[^0-9.]/g, "")) * 100) : null)
    || (releaseType === "album" ? 1299 : releaseType === "ep" || releaseType === "mixtape" ? 999 : 299);

  const resolvedReleaseDate = release_date || new Date().toISOString().slice(0, 10);

  // Build credits payload
  const credits = {
    produced_by:        produced_by || [],
    written_by:         written_by || [],
    mixing_engineer:    mixing_engineer || null,
    mastering_engineer: mastering_engineer || null,
    executive_producer: executive_producer || null,
    isrc:               isrc || null,
    featured_artists:   featured_artists || [],
  };

  // ── 6. Upsert products row ─────────────────────────────────────────────────
  const { data: product, error: productErr } = await admin
    .from("products")
    .upsert(
      {
        slug:          releaseSlug,
        title:         title.trim(),
        display_title: title.trim(),
        product_type:  PRODUCT_TYPE_MAP[releaseType] || "single",
        release_type:  normalizeReleaseType(releaseType),
        release_date:  resolvedReleaseDate,
        price_cents:   resolvedPriceCents,
        active:        newStatus === "published",
        release_id:    releaseId,
        storage_path,
        artwork_path,
        preview_path,
        video_path,
        cover_url:     visual || null,
        image_path:    artwork_path,
        credits,
        metadata: {
          release_type:             releaseType,
          release_category:         releaseType,
          canonical:                false,
          published_by_upload_system: true,
          genre:                    genre || null,
          content_rating:           content_rating || null,
          featured_artists:         featured_artists || [],
          cover_art_r2_key:         resolvedCoverKey,
        },
        gifting_enabled: false,
      },
      { onConflict: "slug" }
    )
    .select("id")
    .single();

  if (productErr) {
    console.error("[publish] products upsert error", productErr.message);
    return NextResponse.json({ error: "Publish failed — could not write to storefront catalog" }, { status: 500 });
  }

  const productId = product.id;

  // ── 7. For multi-track: upsert catalog_tracks ──────────────────────────────
  if (isMultiTrack && readyTracks.length > 0) {
    const trackRows = readyTracks.map((t, i) => {
      const tCredits = {
        produced_by:    t.track_credits?.produced_by    ?? produced_by  ?? [],
        written_by:     t.track_credits?.written_by     ?? written_by   ?? [],
        isrc:           t.track_credits?.isrc           || null,
        content_rating: t.track_credits?.content_rating || content_rating || "clean",
      };
      const tFeatured = t.featured_artists ?? featured_artists ?? [];
      return {
        slug:             t.slug || `track-${i + 1}`,
        title:            t.title || `Track ${i + 1}`,
        display_title:    t.title || `Track ${i + 1}`,
        album_slug:       releaseSlug,
        track_number:     t.position || (i + 1),
        position:         t.position || (i + 1),
        product_id:       productId,
        track_id:         t.id,
        storage_path:     resolveStoragePath(typeFolder, releaseSlug, t.slug),
        preview_path:     resolvePreviewPath(typeFolder, t.slug, releaseSlug),
        lyrics:           t.lyrics || null,
        credits:          tCredits,
        featured_artists: tFeatured,
        metadata:         {},
      };
    });

    const { error: trackErr } = await admin
      .from("catalog_tracks")
      .upsert(trackRows, { onConflict: "album_slug,slug" });

    if (trackErr) {
      console.error("[publish] catalog_tracks upsert error (non-fatal)", trackErr.message);
    }
  }

  // For singles/features: update the tracks row with title + lyrics + isrc
  if (!isMultiTrack && track_id) {
    const singleTrackUpdate = { position: 1 };
    if (title?.trim()) singleTrackUpdate.title = title.trim();
    if (lyrics)        singleTrackUpdate.lyrics = lyrics;
    if (isrc)          singleTrackUpdate.isrc   = isrc;
    await admin.from("tracks").update(singleTrackUpdate).eq("id", track_id).catch(() => {});
  }

  // ── 8. Update releases row status + canonical slug ─────────────────────────
  const releaseUpdate = {
    status:             newStatus,
    storefront_visible: !scheduled_at,
    slug:               releaseSlug,
    scheduled_at:       scheduled_at || null,
    release_date:       resolvedReleaseDate,
  };

  // Write credits columns that exist on releases
  if (executive_producer) releaseUpdate.executive_producer = executive_producer;
  if (mixing_engineer)    releaseUpdate.mixing_engineer    = mixing_engineer;
  if (mastering_engineer) releaseUpdate.mastering_engineer = mastering_engineer;
  if (publishing_credits) releaseUpdate.publishing_credits = publishing_credits;
  if (upc)               releaseUpdate.upc = upc;
  if (copyright_year)    releaseUpdate.copyright_year = parseInt(copyright_year, 10) || null;
  if (c_line)            releaseUpdate.c_line = c_line;
  if (p_line)            releaseUpdate.p_line = p_line;

  await admin.from("releases").update(releaseUpdate).eq("id", releaseId).catch((err) => {
    console.warn("[publish] release status update error (non-fatal)", err?.message);
  });

  // ── 9. Cache invalidation ──────────────────────────────────────────────────
  try {
    revalidatePath("/");
    revalidatePath(`/song/${releaseSlug}`);
    revalidatePath(`/feature/${releaseSlug}`);
    revalidatePath(`/album/${releaseSlug}`);
  } catch (err) {
    console.warn("[publish] revalidatePath error (non-fatal)", err?.message);
  }

  console.info(`[publish] SUCCESS releaseId=${releaseId} slug=${releaseSlug} productId=${productId} status=${newStatus}`);

  return NextResponse.json({ ok: true, slug: releaseSlug, product_id: productId, status: newStatus, scheduled_at: scheduled_at || null });
}
