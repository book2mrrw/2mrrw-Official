import { NextResponse } from "next/server";
import { getAdminSessionUser } from "@/lib/auth/admin-api-guard";
import { isAdminUser } from "@/lib/auth/constants";
import { getAdminClient } from "@/lib/supabase/admin";
import { headR2ObjectKey, copyR2Object, deleteR2Object } from "@/lib/storage/r2";
import { buildHLSPrefix } from "@/lib/hls/derive-key";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import { revalidateStorefront } from "@/lib/media/revalidate-storefront";
import {
  resolveStoragePath,
  resolvePreviewPath,
  resolveArtworkPath,
  resolveVideoPath,
  visualDiscoveryUrl,
  previewDiscoveryUrl,
} from "@/lib/media/canonical-paths";
import { normalizeReleaseType } from "@/lib/media/utils/normalize-release-type";
import { validateLifecycleConfiguration } from "@/lib/releases/release-availability";

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
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function slugify(title) {
  return String(title || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || `release-${Date.now()}`;
}

export async function POST(req, { params }) {
  const user = await getAdminSessionUser();
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

  const { id: releaseId } = await params;
  if (!releaseId) return NextResponse.json({ error: "Release ID was not supplied to the publish endpoint" }, { status: 400 });
  if (!UUID_RE.test(releaseId)) return NextResponse.json({ error: "Release ID is malformed" }, { status: 400 });

  let body;
  try { body = await req.json(); } catch { body = {}; }

  // All wizard-collected data comes from the request body
  const {
    title,
    price,             // string "$2.99" or number
    price_cents,       // number override
    release_date,
    genre,
    genre_classifications = null,
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
    release_timezone = "America/Chicago",
    upcoming_visible = false,
    preview_before_release = false,
    preorder_enabled = false,
    preorder_starts_at = null,
    preorder_price_cents = null,
    early_access_enabled = false,
    early_access_starts_at = null,
    early_access_scope = { mode: "full_release", track_ids: [] },
    early_access_audiences = ["preorder_purchasers"],
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
  // Re-publishing is an idempotent projection refresh for the same release ID.

  const releaseType = release.release_type;
  const typeFolder  = RELEASE_TYPE_FOLDERS[releaseType] || "singles";
  const isMultiTrack = ["album", "ep", "mixtape"].includes(releaseType);

  // ── 2. Load tracks ─────────────────────────────────────────────────────────
  const { data: dbTracks } = await admin
    .from("tracks")
    .select("id, title, upload_status, audio_r2_key, master_r2_key, position, lyrics")
    .eq("release_id", releaseId);

  // Merge body track data (titles, lyrics, credits overrides) into DB rows
  const tracks = (dbTracks || []).map((dbTrack) => {
    const bodyTrack = bodyTracks.find((bt) =>
      bt.id === dbTrack.id || Number(bt.position) === Number(dbTrack.position)
    );
    const stableSlug = bodyTrack?.slug || slugify(bodyTrack?.title || dbTrack.title || `track-${dbTrack.position || 1}`);
    if (!bodyTrack) return { ...dbTrack, slug: stableSlug };
    return {
      ...dbTrack,
      slug:             stableSlug,
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
  const availableAt = scheduled_at || new Date().toISOString();
  const lifecycle = {
    status: newStatus,
    available_at: availableAt,
    preorder_enabled: Boolean(preorder_enabled),
    preorder_starts_at,
    preorder_price_cents: preorder_price_cents == null ? null : Number(preorder_price_cents),
    early_access_enabled: Boolean(early_access_enabled),
    early_access_starts_at,
    release_timezone,
  };
  const lifecycleErrors = validateLifecycleConfiguration(lifecycle);
  if (lifecycleErrors.length) {
    return NextResponse.json({ error: `BLOCKING: ${lifecycleErrors.join("; ")}` }, { status: 422 });
  }

  // ── 5. Build canonical slug ────────────────────────────────────────────────
  const existingSlug = release.slug;
  const releaseSlug = (!existingSlug || existingSlug.startsWith("draft-"))
    ? slugify(title)
    : existingSlug;

  // ── 5b. Canonicalize audio R2 paths ───────────────────────────────────────
  // Wizard uploads land at draft-slug paths (e.g. digital-assets/singles/draft-xxx/draft-xxx.wav).
  // resolvePlaybackKey discovers audio by scanning storage_path, which is keyed
  // to the final slug. Copy each audio file to its canonical location now so
  // the audio pipeline can find it immediately after publish.
  const HLS_FOLDER_MAP = {
    single: "singles", feature: "features",
    album: "albums", ep: "mixtapes-and-eps", mixtape: "mixtapes-and-eps",
  };
  const hlsFolder = HLS_FOLDER_MAP[releaseType] || "singles";

  function extFromKey(k) {
    const i = String(k || "").lastIndexOf(".");
    return i >= 0 ? k.slice(i) : "";
  }

  for (const track of readyTracks) {
    const srcKey = track.audio_r2_key;
    if (!srcKey) continue;

    const ext = extFromKey(srcKey);
    const destKey = isMultiTrack
      ? `digital-assets/${typeFolder}/${releaseSlug}/${track.slug}/${track.slug}${ext}`
      : `digital-assets/${typeFolder}/${releaseSlug}/${releaseSlug}${ext}`;

    if (srcKey === destKey) continue; // already at canonical path (R2-ingest releases)

    // Copy audio to canonical path — blocking: a published release must have accessible audio
    try {
      await copyR2Object(srcKey, destKey);
    } catch (err) {
      console.error(`[publish] R2 audio copy failed for track ${track.id}:`, err?.message);
      return NextResponse.json(
        { error: "Publish failed — could not move audio to canonical storage. Please try again." },
        { status: 500 }
      );
    }

    // Update DB: canonical audio_r2_key (and master_r2_key if it followed the same draft pattern)
    const trackUpdateFields = { audio_r2_key: destKey };
    if (track.master_r2_key && track.master_r2_key !== srcKey) {
      const masterExt = extFromKey(track.master_r2_key);
      const masterDest = isMultiTrack
        ? `digital-assets/${typeFolder}/${releaseSlug}/${track.slug}/${track.slug}-master${masterExt}`
        : `digital-assets/${typeFolder}/${releaseSlug}/${releaseSlug}-master${masterExt}`;
      if (track.master_r2_key !== masterDest) {
        try {
          await copyR2Object(track.master_r2_key, masterDest);
          trackUpdateFields.master_r2_key = masterDest;
        } catch {
          // master_r2_key is supplementary — non-fatal
        }
      }
    }
    await admin.from("tracks").update(trackUpdateFields).eq("id", track.id).catch((err) => {
      console.warn("[publish] track audio_r2_key update error (non-fatal)", err?.message);
    });

    // Update the HLS transcode job queued at upload time (used draft slug/prefix/source_key)
    // Skip jobs currently being processed by the worker — they'll be corrected on next sync
    const newHlsPrefix = buildHLSPrefix(releaseSlug, isMultiTrack ? track.slug : null, hlsFolder);
    await admin
      .from("hls_transcode_jobs")
      .update({
        source_key:    destKey,
        slug:          releaseSlug,
        track_slug:    isMultiTrack ? track.slug : null,
        hls_prefix:    newHlsPrefix,
        status:        "pending",
        attempt_count: 0,
        error_message: null,
      })
      .eq("source_key", srcKey)
      .neq("status", "processing")
      .catch((err) => {
        console.warn("[publish] HLS job canonicalize error (non-fatal)", err?.message);
      });

    // Clean up draft file — non-fatal; leave on failure (worker may still be reading)
    await deleteR2Object(srcKey).catch(() => {});
  }

  // ── 5c. Canonicalize cover art path ───────────────────────────────────────
  // Cover art uploaded during wizard lands at images/{folder}/draft-xxx/draft-xxx.ext.
  // Move it to the canonical images/{folder}/{slug}/{slug}.ext so both the releases
  // cover_art_r2_key and the catalog image_path folder discovery agree.
  let canonicalCoverKey = resolvedCoverKey;
  if (resolvedCoverKey) {
    const coverExt = extFromKey(resolvedCoverKey);
    const targetCoverKey = coverExt
      ? `images/${typeFolder}/${releaseSlug}/${releaseSlug}${coverExt}`
      : resolvedCoverKey;
    if (targetCoverKey !== resolvedCoverKey) {
      try {
        await copyR2Object(resolvedCoverKey, targetCoverKey);
        await admin.from("releases").update({ cover_art_r2_key: targetCoverKey }).eq("id", releaseId).catch(() => {});
        await deleteR2Object(resolvedCoverKey).catch(() => {});
        canonicalCoverKey = targetCoverKey;
      } catch (err) {
        console.warn("[publish] cover art canonicalize error (non-fatal)", err?.message);
        // canonicalCoverKey stays as resolvedCoverKey — display degrades but publish succeeds
      }
    }
  }

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
        // active means listed in the catalog. Playback authority is evaluated
        // independently from releases.available_at on every protected request.
        active:        newStatus === "published" || Boolean(upcoming_visible),
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
          cover_art_r2_key:         canonicalCoverKey,
          lifecycle_managed:        true,
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

  // Canonical many-classification taxonomy. The legacy metadata.genre string
  // remains a display-compatible projection, never the editing authority.
  if (genre_classifications?.primary) {
    const classificationRows = [
      { taxonomy_id: genre_classifications.primary, role: "primary", sort_order: 0 },
      ...[...new Set(genre_classifications.subgenres || [])]
        .filter((id) => id && id !== genre_classifications.primary)
        .map((taxonomy_id, index) => ({ taxonomy_id, role: "subgenre", sort_order: index })),
      ...[...new Set(genre_classifications.secondary || [])]
        .filter((id) => id && id !== genre_classifications.primary && !(genre_classifications.subgenres || []).includes(id))
        .map((taxonomy_id, index) => ({ taxonomy_id, role: "secondary", sort_order: index })),
    ].map((row) => ({ ...row, release_id: releaseId }));
    const ids = classificationRows.map((row) => row.taxonomy_id);
    const { data: validTaxonomy, error: taxonomyError } = await admin.from("genre_taxonomy").select("id").in("id", ids).eq("active", true);
    if (taxonomyError || (validTaxonomy || []).length !== ids.length) {
      return NextResponse.json({ error: "BLOCKING: One or more genre classifications are invalid or disabled" }, { status: 422 });
    }
    await admin.from("release_genre_classifications").delete().eq("release_id", releaseId);
    const { error: classificationError } = await admin.from("release_genre_classifications").insert(classificationRows);
    if (classificationError) return NextResponse.json({ error: `Genre classification failed: ${classificationError.message}` }, { status: 500 });
  }

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

    // Blocking: a multi-track release must never be marked live with an
    // incomplete or missing tracklist. Treating this as non-fatal previously
    // meant the release could go on to be flipped to published/scheduled below
    // with zero playable tracks in the storefront's catalog_tracks table.
    if (trackErr) {
      console.error("[publish] catalog_tracks upsert error", trackErr.message);
      return NextResponse.json(
        { error: `Publish failed — could not save the tracklist: ${trackErr.message}` },
        { status: 500 }
      );
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
    storefront_visible: !scheduled_at || Boolean(upcoming_visible),
    slug:               releaseSlug,
    scheduled_at:       scheduled_at || null,
    available_at:       availableAt,
    release_timezone,
    upcoming_visible:   Boolean(upcoming_visible),
    preview_before_release: Boolean(preview_before_release),
    preorder_enabled:   Boolean(preorder_enabled),
    preorder_starts_at,
    preorder_price_cents: preorder_price_cents == null ? null : Number(preorder_price_cents),
    early_access_enabled: Boolean(early_access_enabled),
    early_access_starts_at,
    early_access_scope,
    early_access_audiences,
    published_at:       scheduled_at ? null : new Date().toISOString(),
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

  // Blocking: this is the actual lifecycle transition — the write that makes
  // releaseAvailability() start returning visible:true. Every prior step in
  // this request (R2 canonicalization, the products upsert, catalog_tracks)
  // is preparation for this moment. Treating its failure as non-fatal meant
  // the admin could be told "Published" while the release silently stayed in
  // status:"draft" forever, with no visible sign anything was wrong.
  const { error: releaseUpdateErr } = await admin
    .from("releases")
    .update(releaseUpdate)
    .eq("id", releaseId);
  if (releaseUpdateErr) {
    console.error("[publish] release status update error", releaseUpdateErr.message);
    return NextResponse.json(
      { error: `Publish failed — the release lifecycle transition did not commit: ${releaseUpdateErr.message}. The release is still a draft; press Publish again once resolved.` },
      { status: 500 }
    );
  }
  await admin.from("release_drafts").delete().eq("release_id", releaseId);

  // ── 9. Cache invalidation ──────────────────────────────────────────────────
  revalidateStorefront(releaseSlug, releaseType);

  console.info(`[publish] SUCCESS releaseId=${releaseId} slug=${releaseSlug} productId=${productId} status=${newStatus}`);

  return NextResponse.json({ ok: true, slug: releaseSlug, product_id: productId, status: newStatus, scheduled_at: scheduled_at || null });
}
