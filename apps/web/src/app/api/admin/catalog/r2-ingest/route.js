/**
 * POST /api/admin/catalog/r2-ingest
 *
 * Automated R2 Media Ingestion Pipeline.
 *
 * Scans Cloudflare R2 for new releases organized under canonical folder paths,
 * classifies them by type, discovers all associated media (audio, preview, stream,
 * cover image, motion video), and upserts into the `products` + `catalog_tracks`
 * Supabase tables. After this runs, the storefront catalog is DB-driven — no
 * source-code changes required to publish new music.
 *
 * Auth: x-seed-secret header (same as other admin seed routes).
 *
 * Body (optional JSON):
 *   { dryRun?: boolean }   — true = scan + classify only, no DB writes
 *
 * R2 folder layout expected:
 *   digital-assets/singles/{slug}/            ← audio master
 *   digital-assets/features/{slug}/           ← audio master
 *   digital-assets/mixtapes-and-eps/{albumSlug}/{trackSlug}/
 *   digital-assets/albums/{albumSlug}/{trackSlug}/
 *   previews/singles/{slug}/                  ← preview audio
 *   previews/features/{slug}/
 *   previews/mixtapes-and-eps/{albumSlug}/{trackSlug}/
 *   streaming/singles/{slug}/                 ← AAC stream
 *   streaming/features/{slug}/
 *   streaming/mixtapes-and-eps/{albumSlug}/{trackSlug}/
 *   images/singles/{slug}/                    ← cover image
 *   images/features/{slug}/
 *   images/mixtapes-and-eps/{slug}/
 *   videos/singles/{slug}/                    ← motion cover
 *   videos/features/{slug}/
 *   videos/mixtapes-and-eps/{slug}/
 */

import { NextResponse } from "next/server";
import { ListObjectsV2Command } from "@aws-sdk/client-s3";
import { getAdminClient } from "@/lib/supabase/admin";
import { r2Client, R2_BUCKET } from "@/lib/storage/r2";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import { normalizeReleaseType } from "@/lib/media/utils/normalize-release-type";
import {
  resolveStoragePath,
  resolvePreviewPath,
  resolveStreamPath,
  resolveArtworkPath,
  resolveVideoPath,
  storagePathForProductRow,
} from "@/lib/media/canonical-paths";

// ── Auth ──────────────────────────────────────────────────────────────────────
function authorize(req) {
  const secret = req.headers.get("x-seed-secret");
  return Boolean(process.env.ADMIN_SEED_SECRET && secret === process.env.ADMIN_SEED_SECRET);
}

// ── R2 helpers ────────────────────────────────────────────────────────────────

/** List immediate subfolder slugs under a prefix (uses S3 CommonPrefixes). */
async function listR2Subfolders(prefix) {
  if (!R2_BUCKET) return [];
  const normalized = String(prefix || "").replace(/^\//, "");
  const listPrefix = normalized.endsWith("/") ? normalized : `${normalized}/`;
  const subfolders = [];
  let continuationToken;

  do {
    const response = await r2Client.send(
      new ListObjectsV2Command({
        Bucket: R2_BUCKET,
        Prefix: listPrefix,
        Delimiter: "/",
        ContinuationToken: continuationToken,
      })
    );
    for (const cp of response.CommonPrefixes || []) {
      if (cp.Prefix) {
        const slug = cp.Prefix.replace(listPrefix, "").replace(/\/$/, "").trim();
        if (slug) subfolders.push(slug);
      }
    }
    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (continuationToken);

  return subfolders;
}

/**
 * Check if any object exists directly under a prefix (first hit only).
 * Much cheaper than listing all objects when we only need existence check.
 */
async function r2FolderHasContent(prefix) {
  if (!R2_BUCKET) return false;
  const normalized = String(prefix || "").replace(/^\//, "");
  const listPrefix = normalized.endsWith("/") ? normalized : `${normalized}/`;
  try {
    const response = await r2Client.send(
      new ListObjectsV2Command({
        Bucket: R2_BUCKET,
        Prefix: listPrefix,
        MaxKeys: 1,
      })
    );
    return Boolean(response.Contents?.length || response.CommonPrefixes?.length);
  } catch {
    return false;
  }
}

/** Discover the first file matching given extensions under a folder prefix. */
async function discoverFile(prefix, extensions) {
  if (!R2_BUCKET) return null;
  const normalized = String(prefix || "").replace(/^\//, "");
  const listPrefix = normalized.endsWith("/") ? normalized : `${normalized}/`;
  try {
    const response = await r2Client.send(
      new ListObjectsV2Command({
        Bucket: R2_BUCKET,
        Prefix: listPrefix,
        Delimiter: "/",
        MaxKeys: 50,
      })
    );
    const keys = (response.Contents || [])
      .map((item) => item.Key)
      .filter(Boolean)
      .filter((key) => !key.endsWith("/"));

    for (const ext of extensions) {
      const suffix = ext.startsWith(".") ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
      const match = keys.find((key) => key.toLowerCase().endsWith(suffix));
      if (match) return match;
    }
    return null;
  } catch {
    return null;
  }
}

// ── Title derivation ──────────────────────────────────────────────────────────

/** Derive a display title from a kebab-case slug. */
function titleFromSlug(slug) {
  return String(slug || "")
    .replace(/^\d+-/, "")         // strip leading position prefix (01-)
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim() || slug;
}

/** Derive track position from slug prefix (01-roll-call → 1). */
function positionFromSlug(slug, fallback = 1) {
  const match = String(slug || "").match(/^(\d+)-/);
  return match ? parseInt(match[1], 10) : fallback;
}

// ── Default prices ────────────────────────────────────────────────────────────
const DEFAULT_PRICE_CENTS = {
  singles: 299,
  features: 299,
  albums: 1299,
  "mixtapes-and-eps": 999,
};

// ── Media discovery for a single/feature release ──────────────────────────────
async function discoverSimpleReleaseMedia(slug, releaseTypeFolder) {
  const audioFolder = `digital-assets/${releaseTypeFolder}/${slug}`;
  const previewFolder = `previews/${releaseTypeFolder}/${slug}`;
  const streamFolder = `streaming/${releaseTypeFolder}/${slug}`;
  const imageFolder = `images/${releaseTypeFolder}/${slug}`;
  const videoFolder = `videos/${releaseTypeFolder}/${slug}`;

  const [audioKey, previewKey, streamKey, imageKey, videoKey] = await Promise.all([
    discoverFile(audioFolder, [".wav", ".flac", ".m4a", ".mp3"]),
    discoverFile(previewFolder, [".mp3", ".wav", ".m4a"]),
    discoverFile(streamFolder, [".m4a", ".mp3"]),
    discoverFile(imageFolder, [".jpg", ".jpeg", ".png", ".webp"]),
    discoverFile(videoFolder, [".mp4", ".webm", ".mov"]),
  ]);

  return {
    hasAudio: Boolean(audioKey),
    audioKey,
    previewKey,
    streamKey,
    imageKey,
    videoKey,
    storagePath: storagePathForProductRow(`${audioFolder}/`),
    previewPath: resolvePreviewPath(releaseTypeFolder, slug),
    streamPath: resolveStreamPath(releaseTypeFolder, slug),
    artworkPath: resolveArtworkPath(releaseTypeFolder, slug),
    videoPath: videoFolder + "/",
  };
}

// ── Track discovery for multi-track releases ─────────────────────────────────
async function discoverAlbumTracks(albumSlug, releaseTypeFolder) {
  const tracksBase = `digital-assets/${releaseTypeFolder}/${albumSlug}`;
  const trackSlugs = await listR2Subfolders(tracksBase);

  const tracks = await Promise.all(
    trackSlugs.map(async (trackSlug, index) => {
      const trackAudioFolder = `${tracksBase}/${trackSlug}`;
      const trackPreviewFolder = `previews/${releaseTypeFolder}/${albumSlug}/${trackSlug}`;
      const trackStreamFolder = `streaming/${releaseTypeFolder}/${albumSlug}/${trackSlug}`;

      const [audioKey, previewKey, streamKey] = await Promise.all([
        discoverFile(trackAudioFolder, [".wav", ".flac", ".m4a", ".mp3"]),
        discoverFile(trackPreviewFolder, [".mp3", ".wav", ".m4a"]),
        discoverFile(trackStreamFolder, [".m4a", ".mp3"]),
      ]);

      return {
        slug: trackSlug,
        title: titleFromSlug(trackSlug),
        position: positionFromSlug(trackSlug, index + 1),
        hasAudio: Boolean(audioKey),
        audioKey,
        previewKey,
        streamKey,
        storagePath: resolveStoragePath(releaseTypeFolder, albumSlug, trackSlug),
        previewPath: resolvePreviewPath(releaseTypeFolder, trackSlug, albumSlug),
        streamPath: resolveStreamPath(releaseTypeFolder, albumSlug, trackSlug),
      };
    })
  );

  return tracks.sort((a, b) => a.position - b.position);
}

// ── Upsert helpers ────────────────────────────────────────────────────────────
async function upsertProduct(admin, payload) {
  const { error } = await admin
    .from("products")
    .upsert(
      { ...payload, updated_at: new Date().toISOString() },
      {
        onConflict: "slug",
        ignoreDuplicates: false,
      }
    );
  return error ? error.message : null;
}

async function upsertTracks(admin, productId, tracks) {
  if (!tracks?.length) return [];
  const rows = tracks.map((t) => ({
    product_id: productId,
    slug: t.slug,
    title: t.title,
    position: t.position,
    storage_path: t.storagePath || null,
    preview_path: t.previewPath || null,
    stream_path: t.streamPath || null,
    metadata: {},
    updated_at: new Date().toISOString(),
  }));

  const { error } = await admin
    .from("catalog_tracks")
    .upsert(rows, { onConflict: "product_id,slug" });

  return error ? [{ error: error.message, trackCount: tracks.length }] : [];
}

async function getProductIdBySlug(admin, slug) {
  const { data } = await admin
    .from("products")
    .select("id")
    .eq("slug", slug)
    .single();
  return data?.id || null;
}

// ── Main handler ──────────────────────────────────────────────────────────────
export async function POST(req) {
  if (!authorize(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limit = await checkRateLimit(req, {
    routeKey: "admin.catalog.r2-ingest",
    limit: 5,
    windowSeconds: 60,
  });
  if (!limit.allowed) return rateLimitResponse(limit.retryAfterSeconds);

  const body = await req.json().catch(() => ({}));
  const dryRun = Boolean(body?.dryRun);

  if (!R2_BUCKET) {
    return NextResponse.json({
      ok: false,
      error: "CLOUDFLARE_R2_BUCKET_NAME is not configured",
    }, { status: 500 });
  }

  const admin = getAdminClient();
  const scannedAt = new Date().toISOString();
  const discovered = { singles: [], features: [], albums: [], mixtapes: [] };
  const failed = [];
  let productsUpserted = 0;
  let tracksUpserted = 0;

  // ── Scan simple releases (singles + features) ─────────────────────────────
  for (const releaseTypeFolder of ["singles", "features"]) {
    const slugs = await listR2Subfolders(`digital-assets/${releaseTypeFolder}`);
    const productType = releaseTypeFolder === "singles" ? "single" : "feature";
    const destArray = releaseTypeFolder === "singles" ? discovered.singles : discovered.features;

    for (const slug of slugs) {
      try {
        const media = await discoverSimpleReleaseMedia(slug, releaseTypeFolder);

        const releaseInfo = {
          slug,
          title: titleFromSlug(slug),
          productType,
          releaseTypeFolder,
          media,
        };
        destArray.push(releaseInfo);

        if (!dryRun) {
          const payload = {
            slug,
            title: titleFromSlug(slug),
            product_type: productType,
            price_cents: DEFAULT_PRICE_CENTS[releaseTypeFolder],
            active: true,
            release_type: releaseTypeFolder,
            storage_path: media.storagePath || null,
            preview_path: media.previewPath || null,
            stream_path: media.streamKey ? media.streamPath : null,
            video_path: media.videoKey ? `videos/${releaseTypeFolder}/${slug}/` : null,
            image_path: media.imageKey ? `images/${releaseTypeFolder}/${slug}/` : null,
            ingested_from_r2_at: scannedAt,
            metadata: {
              release_type: normalizeReleaseType(productType),
              release_category: productType,
              canonical: false,
              r2_ingested: true,
            },
          };

          const err = await upsertProduct(admin, payload);
          if (err) {
            failed.push({ slug, type: productType, error: err });
          } else {
            productsUpserted += 1;
          }
        }
      } catch (err) {
        failed.push({ slug, type: releaseTypeFolder, error: err?.message || "scan_failed" });
      }
    }
  }

  // ── Scan multi-track releases (mixtapes-and-eps + albums) ─────────────────
  for (const releaseTypeFolder of ["mixtapes-and-eps", "albums"]) {
    const albumSlugs = await listR2Subfolders(`digital-assets/${releaseTypeFolder}`);
    const destArray = releaseTypeFolder === "mixtapes-and-eps" ? discovered.mixtapes : discovered.albums;

    for (const albumSlug of albumSlugs) {
      try {
        const [tracks, imageKey, videoKey] = await Promise.all([
          discoverAlbumTracks(albumSlug, releaseTypeFolder),
          discoverFile(`images/${releaseTypeFolder}/${albumSlug}`, [".jpg", ".jpeg", ".png", ".webp"]),
          discoverFile(`videos/${releaseTypeFolder}/${albumSlug}`, [".mp4", ".webm", ".mov"]),
        ]);

        const releaseInfo = {
          slug: albumSlug,
          title: titleFromSlug(albumSlug),
          releaseTypeFolder,
          trackCount: tracks.length,
          tracks,
          imageKey,
          videoKey,
        };
        destArray.push(releaseInfo);

        if (!dryRun) {
          const isEpMixtape = releaseTypeFolder === "mixtapes-and-eps";
          const payload = {
            slug: albumSlug,
            title: titleFromSlug(albumSlug),
            product_type: "album",
            price_cents: DEFAULT_PRICE_CENTS[releaseTypeFolder],
            active: true,
            release_type: releaseTypeFolder,
            storage_path: null,   // multi-track; tracks have their own paths
            preview_path: null,
            stream_path: null,
            video_path: videoKey ? `videos/${releaseTypeFolder}/${albumSlug}/` : null,
            image_path: imageKey ? `images/${releaseTypeFolder}/${albumSlug}/` : null,
            ingested_from_r2_at: scannedAt,
            metadata: {
              release_type: releaseTypeFolder,
              release_category: isEpMixtape ? "mixtape" : "album",
              canonical: false,
              r2_ingested: true,
            },
          };

          const productErr = await upsertProduct(admin, payload);
          if (productErr) {
            failed.push({ slug: albumSlug, type: releaseTypeFolder, error: productErr });
            continue;
          }
          productsUpserted += 1;

          // Upsert tracks
          const productId = await getProductIdBySlug(admin, albumSlug);
          if (productId && tracks.length > 0) {
            const trackErrors = await upsertTracks(admin, productId, tracks);
            if (trackErrors.length > 0) {
              failed.push(...trackErrors.map((e) => ({ slug: albumSlug, ...e })));
            } else {
              tracksUpserted += tracks.length;
            }
          }
        }
      } catch (err) {
        failed.push({ slug: albumSlug, type: releaseTypeFolder, error: err?.message || "scan_failed" });
      }
    }
  }

  return NextResponse.json({
    ok: failed.length === 0,
    dryRun,
    discovered: {
      singles: discovered.singles.map((r) => ({
        slug: r.slug,
        title: r.title,
        mediaFound: {
          audio: Boolean(r.media.audioKey),
          preview: Boolean(r.media.previewKey),
          stream: Boolean(r.media.streamKey),
          image: Boolean(r.media.imageKey),
          video: Boolean(r.media.videoKey),
        },
      })),
      features: discovered.features.map((r) => ({
        slug: r.slug,
        title: r.title,
        mediaFound: {
          audio: Boolean(r.media.audioKey),
          preview: Boolean(r.media.previewKey),
          stream: Boolean(r.media.streamKey),
          image: Boolean(r.media.imageKey),
          video: Boolean(r.media.videoKey),
        },
      })),
      albums: discovered.albums.map((r) => ({
        slug: r.slug,
        title: r.title,
        trackCount: r.trackCount,
        imageFound: Boolean(r.imageKey),
        videoFound: Boolean(r.videoKey),
      })),
      mixtapes: discovered.mixtapes.map((r) => ({
        slug: r.slug,
        title: r.title,
        trackCount: r.trackCount,
        imageFound: Boolean(r.imageKey),
        videoFound: Boolean(r.videoKey),
      })),
    },
    summary: {
      singlesDiscovered: discovered.singles.length,
      featuresDiscovered: discovered.features.length,
      albumsDiscovered: discovered.albums.length,
      mixtapesDiscovered: discovered.mixtapes.length,
      productsUpserted: dryRun ? 0 : productsUpserted,
      tracksUpserted: dryRun ? 0 : tracksUpserted,
      failed: failed.length,
    },
    failed,
    scannedAt,
  });
}
