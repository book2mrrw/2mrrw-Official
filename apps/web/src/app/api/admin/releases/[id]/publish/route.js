import {verifyLyricInput,rebindCopiedLyrics} from "@/lib/lyrics/audio-source";
import { publicationCredits, metadataPatch, publicationTrackOverrides } from "@/lib/credits/publication";
import { validateCreditGroups, optionalIdentifier, publicCredits } from "@/lib/credits/contract";
import { creditStorageCapabilities } from "@/lib/credits/admin-store";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getAdminSessionUser } from "@/lib/auth/admin-api-guard";
import { isAdminUser } from "@/lib/auth/constants";
import { getAdminClient } from "@/lib/supabase/admin";
import { headR2ObjectKey, copyR2Object, getPublicR2Url } from "@/lib/storage/r2";
import { submitAudioJob } from "@/lib/hls/submit-audio-job";
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
import { clearPersistedPreviewKey } from "@/lib/playback/resolve-playback-key";
import { clearEntityResolverCaches } from "@/lib/media/entity-resolver";

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

  const admin = getAdminClient();
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Invalid publication payload" }, { status: 400 });
  const creditInput = body;
  if (Array.isArray(body.tracks) && body.tracks.some(row => !row || typeof row !== "object" || Array.isArray(row))) return NextResponse.json({ error: "Each recording must be an object" }, { status: 422 });
  const creditErrors = [body, ...(Array.isArray(body.tracks) ? body.tracks : [])].flatMap(value => value?.credit_groups ? validateCreditGroups(value.credit_groups) : []);
  try {
    if (Object.hasOwn(body, "upc")) optionalIdentifier(body.upc, "UPC/EAN");
    for (const recording of [body, ...(Array.isArray(body.tracks) ? body.tracks : [])]) if (Object.hasOwn(recording, "isrc")) optionalIdentifier(recording.isrc, "ISRC");
  } catch (error) { creditErrors.push(error.message); }
  if (creditErrors.length) return NextResponse.json({ error: creditErrors.join(" ") }, { status: 422 });
  if (body.tracks !== undefined && !Array.isArray(body.tracks)) return NextResponse.json({ error: "Recordings must be a list" }, { status: 422 });
  const capability = await creditStorageCapabilities(admin);
  if (!capability.ready) return NextResponse.json({ error: capability.reason }, { status: 503 });
  const { data: existingProduct, error: existingProductError } = await admin.from("products").select("id,title,price_cents,credits,metadata").eq("release_id", releaseId).maybeSingle();
  if (existingProductError) return NextResponse.json({ error: "Could not load existing credits before publication" }, { status: 503 });
  const { data: existingCatalogTracks, error: existingCatalogError } = existingProduct
    ? await admin.from("catalog_tracks").select("id,track_id,slug,credits,metadata").eq("product_id", existingProduct.id)
    : { data: [] };
  if (existingCatalogError) return NextResponse.json({ error: "Could not load existing recording credits before publication" }, { status: 503 });

  // ── 1. Load the release record ─────────────────────────────────────────────
  const { data: release, error: relErr } = await admin
    .from("releases")
    .select("*")
    .eq("id", releaseId)
    .is("deleted_at", null)
    .single();

  if (relErr || !release) {
    return NextResponse.json({ error: "Release not found" }, { status: 404 });
  }
  // Partial republish requests inherit saved metadata; omission is never deletion.
  if (release.status !== "draft") body = {
    title: existingProduct?.title || release.title,
    price_cents: existingProduct?.price_cents,
    release_date: release.release_date,
    ...Object.fromEntries(['scheduled_at', 'release_timezone', 'upcoming_visible', 'preview_before_release', 'preorder_enabled', 'preorder_starts_at', 'preorder_price_cents', 'early_access_enabled', 'early_access_starts_at', 'early_access_scope', 'early_access_audiences'].map(key => [key, release[key]])),
    ...body,
  };
  // All wizard-collected data comes from the request body
  const {
    title,
    price,             // string "$2.99" or number
    price_cents,       // number override
    release_date,
    genre,
    genre_classifications = null,
    content_rating,
    featured_artists,
    produced_by,
    written_by,
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
    preview_key,       // R2 key of the browser-derived preview clip, set by /upload/complete
    preview_start_seconds = 0,
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

  const { data: savedRevision, error: revisionError } = await admin.rpc("get_release_publication_revision", { p_release_ref_id: releaseId });
  if (revisionError || !savedRevision) return NextResponse.json({ error: "Could not verify the release revision before publishing" }, { status: 503 });
  const publicationRevision = creditInput.revision || savedRevision;
  const canonicalTrackUpdates = new Map();
  // Re-publishing is an idempotent projection refresh for the same release ID.
  // Preview readiness is only enforced on the FIRST publish — a release that
  // predates this requirement must remain editable/re-publishable without
  // retroactively demanding a preview it was never asked to have.
  const isFirstPublish = release.status === "draft";

  const releaseType = release.release_type;
  const typeFolder  = RELEASE_TYPE_FOLDERS[releaseType] || "singles";
  const isMultiTrack = ["album", "ep", "mixtape"].includes(releaseType);

  // ── 2. Load tracks ─────────────────────────────────────────────────────────
  const { data: dbTracks, error: tracksError } = await admin
    .from("tracks")
    .select("id, title, upload_status, audio_r2_key, master_r2_key, position, lyrics, preview_r2_key, preview_start_seconds")
    .eq("release_id", releaseId)
    .is("removed_from_release_at", null);

  if (tracksError) return NextResponse.json({ error: "Could not load recordings before publication" }, { status: 503 });
  let trackOverrides;
  try {
    trackOverrides = publicationTrackOverrides(bodyTracks, dbTracks || [], { allowPlaceholder: !isMultiTrack });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 422 });
  }

  // Merge body track data (titles, lyrics, credits overrides) into DB rows.
  // preview_key/preview_start_seconds prefer the durable per-track DB column
  // (written by /api/admin/upload/complete, scoped by trackId) over the
  // client-reported wizard state — a resumed/reloaded wizard session can lose
  // its in-memory preview_key (the browser File it was derived from doesn't
  // survive a page reload), but the DB write from the original upload persists.
  const tracks = (dbTracks || []).map((dbTrack) => {
    const bodyTrack = trackOverrides.get(dbTrack.id);
    const stableSlug = (existingCatalogTracks || []).find(track => track.track_id === dbTrack.id)?.slug || bodyTrack?.slug || slugify(bodyTrack?.title || dbTrack.title || `track-${dbTrack.position || 1}`);
    const previewKey = dbTrack.preview_r2_key || bodyTrack?.preview_key || null;
    const previewStartSeconds = dbTrack.preview_r2_key
      ? (dbTrack.preview_start_seconds ?? 0)
      : (bodyTrack?.preview_start_seconds ?? 0);
    if (!bodyTrack) return { ...dbTrack, slug: stableSlug, preview_key: previewKey, preview_start_seconds: previewStartSeconds };
    return {
      ...dbTrack,
      slug:             stableSlug,
      title:            bodyTrack.title    || dbTrack.title,
      position:         bodyTrack.position ?? dbTrack.position,
      lyrics:           Object.hasOwn(bodyTrack, "lyrics") ? bodyTrack.lyrics : dbTrack.lyrics,
      preview_key:            previewKey,
      preview_start_seconds:  previewStartSeconds,
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
  try {
    for (const track of readyTracks) {
      if (!isMultiTrack && Object.hasOwn(creditInput, "lyrics")) track.lyrics = creditInput.lyrics;
      track.lyrics ??= "";
      await verifyLyricInput(admin, releaseId, track.id, track.lyrics);
    }
  } catch (error) {
    return NextResponse.json({error: error.status ? error.message : "Lyric timing could not be verified before publication."}, {status:error.status || 503});
  }


  // A completed upload must have a durable track identity before publication.
  const hasAudioFromDB   = readyTracks.length > 0;

  if (!isMultiTrack && !hasAudioFromDB) {
    return NextResponse.json({ error: "BLOCKING: Audio master must be uploaded before publishing" }, { status: 422 });
  }
  if (isMultiTrack && !hasAudioFromDB) {
    return NextResponse.json({ error: "BLOCKING: At least one track must have audio uploaded" }, { status: 422 });
  }

  // Preview readiness — only enforced the first time a release goes live (see
  // isFirstPublish above). A release with working full playback and a broken
  // or missing preview is not considered successfully published.
  //
  // For single/feature releases, the durable per-track column (tracks.preview_r2_key,
  // already merged onto `tracks` above) is authoritative — falls back to the
  // client-reported body field and, last, the legacy release-level metadata
  // field for any release that predates per-track scoping.
  const singleTrackPreview = !isMultiTrack ? (tracks.find((t) => t.id === track_id) || tracks[0]) : null;
  const resolvedPreviewKey = singleTrackPreview?.preview_key || preview_key || release.metadata?.preview_r2_key || null;
  const resolvedPreviewStartSeconds = singleTrackPreview?.preview_key
    ? (singleTrackPreview.preview_start_seconds ?? 0)
    : (Number(preview_start_seconds) || 0);
  if (isFirstPublish) {
    if (!isMultiTrack && !resolvedPreviewKey) {
      return NextResponse.json({ error: "BLOCKING: A preview clip must be set before publishing" }, { status: 422 });
    }
    if (isMultiTrack) {
      const tracksMissingPreview = readyTracks.filter((t) => !t.preview_key);
      if (tracksMissingPreview.length) {
        return NextResponse.json(
          { error: `BLOCKING: ${tracksMissingPreview.length} track(s) are missing a preview clip` },
          { status: 422 }
        );
      }
    }
  }

  // ── 4. Resolve final status (needed for product active flag) ──────────────
  const availableAt = scheduled_at || (!isFirstPublish ? release.available_at : null) || new Date().toISOString();
  const newStatus = Date.parse(availableAt) > Date.now() ? "scheduled" : "published";
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
  // Same mapping as RELEASE_TYPE_FOLDERS above (typeFolder) — this used to be
  // a second, independently-maintained copy of the identical table.
  const hlsFolder = typeFolder;

  function extFromKey(k) {
    const i = String(k || "").lastIndexOf(".");
    return i >= 0 ? k.slice(i) : "";
  }

  for (const track of readyTracks) {
    const srcKey = track.audio_r2_key;
    if (!srcKey) continue;

    const ext = extFromKey(srcKey);
    const folder = isMultiTrack
      ? `digital-assets/${typeFolder}/${releaseSlug}/${track.slug}/`
      : `digital-assets/${typeFolder}/${releaseSlug}/`;
    const alreadyCanonical = srcKey.startsWith(folder) && !srcKey.slice(folder.length).includes("/");
    const destKey = alreadyCanonical ? srcKey
      : `${folder}${isMultiTrack ? track.slug : releaseSlug}-${randomUUID()}${ext}`;

    if (srcKey === destKey) {
      try {
        await submitAudioJob({ admin, slug: releaseSlug, trackSlug: isMultiTrack ? track.slug : null,
          releaseType: hlsFolder, reuseComplete: true, sourceKey: track.master_r2_key || srcKey, queuedBy: user.id });
      } catch (error) {
        return NextResponse.json({ error: error.message }, { status: error.status || 503 });
      }
      continue;
    }

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
    const trackUpdateFields = { audio_r2_key: destKey, ...(track.master_r2_key === srcKey ? { master_r2_key: destKey } : {}) };
    // A separate original master remains at its immutable source location.
    // Only the public audio projection needs a canonical catalog folder.
    canonicalTrackUpdates.set(track.id, { id: track.id, ...trackUpdateFields });

    try {
      await submitAudioJob({ admin, slug: releaseSlug, trackSlug: isMultiTrack ? track.slug : null,
        releaseType: hlsFolder, reuseComplete: true, sourceKey: trackUpdateFields.master_r2_key || track.master_r2_key || destKey,
        queuedBy: user.id });
    } catch (error) {
      return NextResponse.json({ error: error.message }, { status: error.status || 503 });
    }
    Object.assign(track, trackUpdateFields);
    // Retain draft masters: an existing worker may still reference them.
    // Deletion belongs to a separate reference-aware retention process.

  }

  try {
    for (const track of readyTracks) if (canonicalTrackUpdates.has(track.id)) {
      track.lyrics = await rebindCopiedLyrics(track.lyrics, track.id, track.audio_r2_key);
    }
  } catch { return NextResponse.json({error:"Copied recording timing could not be verified; publication was not committed."},{status:503}); }

  // ── 5b2. Canonicalize preview clip path(s) ────────────────────────────────
  // Preview clips (browser-derived from the master, see PreviewTrimPicker in
  // UploadWizard.js) land at the same draft-slug pattern as audio/cover.
  // resolvePreviewKey discovers a preview by scanning the canonical
  // previews/ folder for the final slug — move each clip there now so it's
  // actually found once the release is live, not just recorded in metadata.
  //
  // Single/feature ONLY — a multi-track release's preview is entirely
  // per-track (the loop below). This used to run unconditionally: for a
  // multi-track release, release.metadata.preview_r2_key could still hold a
  // stray value (a track's own preview key, written there by the pre-fix
  // upload/complete handler that had no per-track scoping at all), and this
  // block would copy THAT ONE track's real preview file to a meaningless
  // release-level path and delete the original — destroying it before the
  // per-track loop below ever got a chance to canonicalize it correctly.
  let canonicalPreviewKey = resolvedPreviewKey;
  if (!isMultiTrack && resolvedPreviewKey) {
    const ext = extFromKey(resolvedPreviewKey) || ".wav";
    const destKey = `previews/${typeFolder}/${releaseSlug}/${releaseSlug}-preview${ext}`;
    if (resolvedPreviewKey !== destKey) {
      try {
        await copyR2Object(resolvedPreviewKey, destKey);

        canonicalPreviewKey = destKey;
      } catch (err) {
        console.warn("[publish] preview canonicalize error (non-fatal for re-publish)", err?.message);
        if (isFirstPublish) {
          return NextResponse.json(
            { error: "Publish failed — could not move the preview clip to canonical storage. Please try again." },
            { status: 500 }
          );
        }
      }
    }
    // A stale negative (from a play attempt before this publish) must not
    // outlive this fix, and a re-published clip's new content should be
    // discoverable immediately rather than waiting out the cache TTL.

  }

  // track.slug -> exact preview object key, for direct (discovery-free) lookup
  // by resolvePreviewKey once persisted onto catalog_tracks.preview_path below.
  const canonicalTrackPreviewKeys = new Map();
  for (const track of readyTracks) {
    const previewSrcKey = track.preview_key;
    if (!previewSrcKey) continue;
    const ext = extFromKey(previewSrcKey) || ".wav";
    const destKey = `previews/${typeFolder}/${releaseSlug}/${track.slug}/${track.slug}-preview${ext}`;
    if (previewSrcKey === destKey) {
      canonicalTrackPreviewKeys.set(track.slug, destKey);
      continue;
    }
    try {
      await copyR2Object(previewSrcKey, destKey);

      canonicalTrackPreviewKeys.set(track.slug, destKey);

    } catch (err) {
      console.warn(`[publish] track ${track.id} preview canonicalize error (non-fatal for re-publish)`, err?.message);
      if (isFirstPublish) {
        return NextResponse.json(
          { error: `Publish failed — could not move the preview clip for track ${track.slug}. Please try again.` },
          { status: 500 }
        );
      }
    }
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
        canonicalCoverKey = targetCoverKey;
      } catch (err) {
        console.warn("[publish] cover art canonicalize error (non-fatal)", err?.message);
        // canonicalCoverKey stays as resolvedCoverKey — display degrades but publish succeeds
      }
    }
  }

  // ── 5d. Canonicalize motion/animated cover video path ──────────────────────
  // Same wizard draft-slug problem as audio/preview/cover above: the animated
  // cover uploaded during the wizard lands at videos/{folder}/draft-xxx/draft-xxx.ext
  // and its key is recorded ONLY in releases.metadata.animated_cover_r2_key —
  // nothing here ever moved it to videos/{folder}/{slug}/, so it stayed
  // orphaned under the draft path forever. The catalog's video resolution
  // (mapProductRow → resolveVisualMedia) does a live R2 folder lookup against
  // videos/{folder}/{slug}/, so a video that was never moved there is
  // functionally invisible — the release silently falls back to its static
  // cover (or, before the catalog-db.js fix, showed nothing at all). Optional
  // and non-fatal, same as cover art: a release with no motion cover has no
  // animated_cover_r2_key and this block is a no-op.
  const resolvedVideoKey = release.metadata?.animated_cover_r2_key || null;
  let canonicalVideoKey = null;
  if (resolvedVideoKey) {
    const videoExt = extFromKey(resolvedVideoKey);
    const targetVideoKey = videoExt
      ? `videos/${typeFolder}/${releaseSlug}/${releaseSlug}${videoExt}`
      : resolvedVideoKey;
    canonicalVideoKey = resolvedVideoKey;
    if (targetVideoKey !== resolvedVideoKey) {
      try {
        await copyR2Object(resolvedVideoKey, targetVideoKey);

        canonicalVideoKey = targetVideoKey;
      } catch (err) {
        console.warn("[publish] motion cover canonicalize error (non-fatal)", err?.message);
        // canonicalVideoKey stays as resolvedVideoKey — display degrades but publish succeeds
      }
    }
    // A stale "no video here" negative from an earlier discovery attempt
    // (e.g. someone loading the release while it was still a draft) must not
    // outlive this fix for up to CACHE_TTL_MS — the freshly-canonicalized
    // video should be discoverable immediately, not after a 5-minute wait.
    clearEntityResolverCaches();
  }

  // ── 6. Build storefront media paths ───────────────────────────────────────
  const storage_path = resolveStoragePath(typeFolder, releaseSlug);
  const artwork_path = resolveArtworkPath(typeFolder, releaseSlug);
  // A preview we generated ourselves (canonicalPreviewKey) is stored as the
  // exact object key, not a folder — resolvePreviewKey then reads it directly
  // with zero R2 discovery, since we already know precisely where it is. Only
  // a release with no generated preview at all falls back to the folder
  // convention (legacy discovery path, single/feature releases predating P0).
  const preview_path = canonicalPreviewKey || resolvePreviewPath(typeFolder, releaseSlug);
  // video_path must reflect reality, not a guess: it's the one field
  // mapProductRow() uses to decide whether a non-single release has a motion
  // cover at all (hasVideo = Boolean(legacyVideo || row.video_path)). Setting
  // it unconditionally — as this used to — told every static-only release
  // "you might have a video," forcing a video-typed render + discovery
  // attempt + fallback for a release that was never meant to have one.
  // Whichever cover type was actually uploaded is the release's one true
  // type; video_path is now only set when canonicalVideoKey confirms a
  // motion cover genuinely exists.
  const video_path   = canonicalVideoKey ? resolveVideoPath(typeFolder, releaseSlug) : null;

  // cover_url is the STATIC cover, always — never a discovery redirect, and
  // never the motion cover. The motion cover travels separately, as
  // metadata.animated_cover_r2_key and video_path.
  //
  // Two things depend on that separation:
  //
  //   1. catalog-db derives `baseCover` straight from cover_url. Writing a
  //      discovery URL there makes baseCover resolve to the VIDEO (discovery
  //      prefers video), so `cover` and `baseCover` collapse to the same value.
  //      GlobalAudioPlayerBar gates animated art on `cover !== baseCover`, so
  //      that collapse is exactly why a mixtape/EP played with no animated
  //      cover — and it also hands an .mp4 to the static <img> layer.
  //   2. /api/media/visual is a force-dynamic 302 and the image optimizer will
  //      not follow it, so a cover published that way was served unoptimized
  //      at full size.
  //
  // The key here is the same object step 3 verified with headR2ObjectKey, so
  // this is a direct reference to something already proven present.
  // catalog-db still builds the discovery URL for `visual`/`video` when a
  // motion cover exists — that indirection stays where it does real work.
  const visual       = canonicalCoverKey
    ? getPublicR2Url(canonicalCoverKey)
    : visualDiscoveryUrl(typeFolder, releaseSlug, {});
  const preview      = previewDiscoveryUrl(preview_path);

  // Price: body price_cents takes priority, then parse price string, then defaults
  const resolvedPriceCents = price_cents
    ?? (price ? Math.round(parseFloat(String(price).replace(/[^0-9.]/g, "")) * 100) : null)
    ?? (releaseType === "album" ? 1299 : releaseType === "ep" || releaseType === "mixtape" ? 999 : 299);

  const resolvedReleaseDate = release_date || new Date().toISOString().slice(0, 10);

  // Build credits payload
  let credits;
  try { credits = publicationCredits(existingProduct?.credits, creditInput); }
  catch (error) { return NextResponse.json({ error: error.message }, { status: 422 }); }


  // ── 6. Upsert products row ─────────────────────────────────────────────────
  const productRow = {
        slug:          releaseSlug,
        title:         title.trim(),
        display_title: title.trim(),
        content_kind:  release.content_kind || "music",
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
          ...metadataPatch(existingProduct?.metadata, body, ["genre", "content_rating", "artist"]),
          ...(!isMultiTrack ? { audio_key: readyTracks[0]?.audio_r2_key } : {}),
          release_type:             releaseType,
          release_category:         releaseType,
          canonical:                false,
          published_by_upload_system: true,
          genre:                    Object.hasOwn(body, "genre") ? genre : existingProduct?.metadata?.genre || null,
          content_rating:           Object.hasOwn(body, "content_rating") ? content_rating : existingProduct?.metadata?.content_rating || null,
          featured_artists:         credits?.featured_artists ?? existingProduct?.metadata?.featured_artists ?? [],
          cover_art_r2_key:         canonicalCoverKey,
          animated_cover_r2_key:    canonicalVideoKey || null,
          preview_r2_key:           canonicalPreviewKey || null,
          preview_start_seconds:    canonicalPreviewKey ? resolvedPreviewStartSeconds : null,
          lifecycle_managed:        true,
        },
        gifting_enabled: false,
      };
  let classificationRows = null;

  // Canonical many-classification taxonomy. The legacy metadata.genre string
  // remains a display-compatible projection, never the editing authority.
  if (genre_classifications?.primary) {
    classificationRows = [
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

  }

  // ── 7. For multi-track: upsert catalog_tracks ──────────────────────────────
  let trackRows = [];
  if (isMultiTrack && readyTracks.length > 0) {
    trackRows = readyTracks.map((t, i) => {
      const priorTrack = (existingCatalogTracks || []).find(row => row.track_id === t.id);
      const requestedTrack = trackOverrides.get(t.id) || {};
      const tCredits = publicationCredits(priorTrack?.credits, {
        ...requestedTrack,
        ...((requestedTrack.inherit_credits === true || (!priorTrack && requestedTrack.inherit_credits !== false)) ? {
          ...(written_by !== undefined ? { written_by } : {}),
          ...(produced_by !== undefined ? { produced_by } : {}),
          ...(featured_artists !== undefined ? { featured_artists } : {}),
        } : {}),
      });
      const tFeatured = publicCredits({ credits: tCredits }).filter(credit => credit.role === "featured_artist").map(credit => credit.name);
      return {
        slug:             t.slug || `track-${i + 1}`,
        title:            t.title || `Track ${i + 1}`,
        display_title:    t.title || `Track ${i + 1}`,
        album_slug:       releaseSlug,
        track_number:     t.position || (i + 1),
        position:         t.position || (i + 1),
        product_id:       existingProduct?.id || null,
        track_id:         t.id,
        storage_path:     resolveStoragePath(typeFolder, releaseSlug, t.slug),
        // Same principle as the single/feature preview_path above — a track
        // preview we generated ourselves is stored as the exact key so
        // resolvePreviewKey never has to fall back to R2 discovery for it.
        preview_path:     canonicalTrackPreviewKeys.get(t.slug) || resolvePreviewPath(typeFolder, t.slug, releaseSlug),
        lyrics:           t.lyrics ?? null,
        credits:          tCredits,
        featured_artists: tFeatured,
        metadata:         { ...(priorTrack?.metadata || {}), audio_key: t.audio_r2_key, ...(t.preview_key ? { preview_start_seconds: Number(t.preview_start_seconds) || 0 } : {}) },
      };
    });

  }


  // ── 8. Update releases row status + canonical slug ─────────────────────────
  const releaseUpdate = {
    title:              title.trim(),
    cover_art_r2_key:    canonicalCoverKey,
    metadata:           { ...(release.metadata || {}), animated_cover_r2_key: canonicalVideoKey || null },
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
    published_at:       !isFirstPublish ? release.published_at : scheduled_at ? null : new Date().toISOString(),
    release_date:       resolvedReleaseDate,
  };

  // Write credits columns that exist on releases
  if (executive_producer) releaseUpdate.executive_producer = executive_producer;
  if (mixing_engineer)    releaseUpdate.mixing_engineer    = mixing_engineer;
  if (mastering_engineer) releaseUpdate.mastering_engineer = mastering_engineer;
  if (publishing_credits) releaseUpdate.publishing_credits = publishing_credits;
  if (Object.hasOwn(body, "upc")) releaseUpdate.upc = optionalIdentifier(upc, "UPC/EAN");
  if (copyright_year)    releaseUpdate.copyright_year = parseInt(copyright_year, 10) || null;
  if (c_line)            releaseUpdate.c_line = c_line;
  if (p_line)            releaseUpdate.p_line = p_line;

  const recordingPatches = readyTracks.map(track => {
    const requested = trackOverrides.get(track.id) || {};
    return {
      id: track.id, ...(canonicalTrackUpdates.get(track.id) || {}),
      title: !isMultiTrack ? title.trim() : track.title,
      position: track.position || 1,
      lyrics: track.lyrics,
      ...(Object.hasOwn(requested, "isrc") ? { isrc: requested.isrc } : !isMultiTrack && Object.hasOwn(creditInput, "isrc") ? { isrc: creditInput.isrc } : {}),
      ...(Object.hasOwn(requested, "credit_groups") ? { credit_groups: requested.credit_groups } : {}),
      ...(!isMultiTrack && isFirstPublish && !requested.credit_groups ? { inherit_credits: true } : {}),
      ...(Object.hasOwn(requested, "inherit_credits") ? { inherit_credits: requested.inherit_credits } : {}),
    };
  });
  const { data: committed, error: commitError } = await admin.rpc("commit_release_publication", {
    p_release_ref_id: releaseId, p_expected_revision: publicationRevision,
    p_payload: { product: productRow, catalog_tracks: trackRows, release: releaseUpdate,
      recordings: recordingPatches, classifications: classificationRows,
      ...(creditInput.credit_groups ? { credit_groups: creditInput.credit_groups } : {}),
    },
  });
  if (commitError) return NextResponse.json({ error: commitError.code === "40001" ? "This release changed during publication. Reload it and retry; your draft is retained." : "Publication could not commit. The release and credits were not partially published." }, { status: commitError.code === "40001" ? 409 : commitError.code === "22023" ? 422 : 500 });
  const productId = committed.product_id;

  await clearPersistedPreviewKey(admin, releaseSlug).catch(() => {});
  for (const track of readyTracks) if (isMultiTrack) await clearPersistedPreviewKey(admin, releaseSlug, track.slug).catch(() => {});

  // ── 9. Cache invalidation ──────────────────────────────────────────────────
  revalidateStorefront(releaseSlug, releaseType);

  console.info(`[publish] SUCCESS releaseId=${releaseId} slug=${releaseSlug} productId=${productId} status=${newStatus}`);

  return NextResponse.json({ ok: true, slug: releaseSlug, product_id: productId, status: newStatus, scheduled_at: scheduled_at || null });
}
