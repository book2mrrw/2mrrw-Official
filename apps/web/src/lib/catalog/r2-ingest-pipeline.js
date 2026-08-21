/**
 * Core R2 catalog ingest pipeline — shared between r2-ingest (secret auth)
 * and ingest-trigger (session auth). No auth, no HTTP, no Next.js concerns.
 * Pass an admin Supabase client + dryRun flag, get back the result object.
 */

import { ListObjectsV2Command } from "@aws-sdk/client-s3";
import { r2Client, R2_BUCKET } from "@/lib/storage/r2";
import { normalizeReleaseType } from "@/lib/media/utils/normalize-release-type";
import {
  resolveStoragePath,
  resolvePreviewPath,
  resolveStreamPath,
  resolveArtworkPath,
  resolveVideoPath,
  storagePathForProductRow,
} from "@/lib/media/canonical-paths";

// ── R2 helpers ────────────────────────────────────────────────────────────────

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

// ── Title / position helpers ──────────────────────────────────────────────────

function titleFromSlug(slug) {
  return String(slug || "")
    .replace(/^\d+-/, "")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim() || slug;
}

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

// ── Media discovery ───────────────────────────────────────────────────────────

async function discoverSimpleReleaseMedia(slug, releaseTypeFolder) {
  const audioFolder   = `digital-assets/${releaseTypeFolder}/${slug}`;
  const previewFolder = `previews/${releaseTypeFolder}/${slug}`;
  const streamFolder  = `streaming/${releaseTypeFolder}/${slug}`;
  const imageFolder   = `images/${releaseTypeFolder}/${slug}`;
  const videoFolder   = `videos/${releaseTypeFolder}/${slug}`;

  const [audioKey, previewKey, streamKey, imageKey, videoKey] = await Promise.all([
    discoverFile(audioFolder,   [".wav", ".flac", ".m4a", ".mp3"]),
    discoverFile(previewFolder, [".mp3", ".wav", ".m4a"]),
    discoverFile(streamFolder,  [".m4a", ".mp3"]),
    discoverFile(imageFolder,   [".jpg", ".jpeg", ".png", ".webp"]),
    discoverFile(videoFolder,   [".mp4", ".webm", ".mov"]),
  ]);

  return {
    hasAudio: Boolean(audioKey),
    audioKey, previewKey, streamKey, imageKey, videoKey,
    storagePath: storagePathForProductRow(`${audioFolder}/`),
    previewPath: resolvePreviewPath(releaseTypeFolder, slug),
    streamPath:  resolveStreamPath(releaseTypeFolder, slug),
    artworkPath: resolveArtworkPath(releaseTypeFolder, slug),
    videoPath:   videoFolder + "/",
  };
}

async function discoverAlbumTracks(albumSlug, releaseTypeFolder) {
  const tracksBase = `digital-assets/${releaseTypeFolder}/${albumSlug}`;
  const trackSlugs = await listR2Subfolders(tracksBase);

  const tracks = await Promise.all(
    trackSlugs.map(async (trackSlug, index) => {
      const trackAudioFolder   = `${tracksBase}/${trackSlug}`;
      const trackPreviewFolder = `previews/${releaseTypeFolder}/${albumSlug}/${trackSlug}`;
      const trackStreamFolder  = `streaming/${releaseTypeFolder}/${albumSlug}/${trackSlug}`;

      const [audioKey, previewKey, streamKey] = await Promise.all([
        discoverFile(trackAudioFolder,   [".wav", ".flac", ".m4a", ".mp3"]),
        discoverFile(trackPreviewFolder, [".mp3", ".wav", ".m4a"]),
        discoverFile(trackStreamFolder,  [".m4a", ".mp3"]),
      ]);

      return {
        slug: trackSlug,
        title: titleFromSlug(trackSlug),
        position: positionFromSlug(trackSlug, index + 1),
        hasAudio: Boolean(audioKey),
        audioKey, previewKey, streamKey,
        storagePath: resolveStoragePath(releaseTypeFolder, albumSlug, trackSlug),
        previewPath: resolvePreviewPath(releaseTypeFolder, trackSlug, albumSlug),
        streamPath:  resolveStreamPath(releaseTypeFolder, albumSlug, trackSlug),
      };
    })
  );

  return tracks.sort((a, b) => a.position - b.position);
}

// ── DB helpers ────────────────────────────────────────────────────────────────

async function upsertProduct(admin, payload) {
  const { error } = await admin
    .from("products")
    .upsert(
      { ...payload, updated_at: new Date().toISOString() },
      { onConflict: "slug", ignoreDuplicates: false }
    );
  return error ? error.message : null;
}

async function upsertTracks(admin, productId, tracks) {
  if (!tracks?.length) return [];
  const rows = tracks.map((t) => ({
    product_id:   productId,
    slug:         t.slug,
    title:        t.title,
    position:     t.position,
    storage_path: t.storagePath || null,
    preview_path: t.previewPath || null,
    stream_path:  t.streamPath  || null,
    metadata:     {},
    updated_at:   new Date().toISOString(),
  }));
  const { error } = await admin
    .from("catalog_tracks")
    .upsert(rows, { onConflict: "product_id,slug" });
  return error ? [{ error: error.message, trackCount: tracks.length }] : [];
}

async function getProductIdBySlug(admin, slug) {
  const { data } = await admin.from("products").select("id").eq("slug", slug).single();
  return data?.id || null;
}

// ── Main pipeline ─────────────────────────────────────────────────────────────

export async function runR2Ingest({ admin, dryRun = false }) {
  if (!R2_BUCKET) {
    return { ok: false, error: "CLOUDFLARE_R2_BUCKET_NAME is not configured" };
  }

  const scannedAt = new Date().toISOString();
  const discovered = { singles: [], features: [], albums: [], mixtapes: [] };
  const failed = [];
  let productsUpserted = 0;
  let tracksUpserted = 0;

  // ── Singles + features ────────────────────────────────────────────────────
  for (const releaseTypeFolder of ["singles", "features"]) {
    const slugs = await listR2Subfolders(`digital-assets/${releaseTypeFolder}`);
    const productType = releaseTypeFolder === "singles" ? "single" : "feature";
    const destArray = releaseTypeFolder === "singles" ? discovered.singles : discovered.features;

    for (const slug of slugs) {
      try {
        // Skip wizard releases that are not yet published — deactivate any stale product
        const { data: wizardRow } = await admin
          .from("releases").select("status").eq("slug", slug).maybeSingle();
        if (wizardRow && wizardRow.status !== "published") {
          if (!dryRun) {
            await admin.from("products")
              .update({ active: false, updated_at: new Date().toISOString() })
              .eq("slug", slug);
          }
          continue;
        }

        const media = await discoverSimpleReleaseMedia(slug, releaseTypeFolder);
        destArray.push({ slug, title: titleFromSlug(slug), productType, releaseTypeFolder, media });

        if (!dryRun) {
          const err = await upsertProduct(admin, {
            slug,
            title:       titleFromSlug(slug),
            product_type: productType,
            price_cents: DEFAULT_PRICE_CENTS[releaseTypeFolder],
            active:      true,
            release_type: releaseTypeFolder,
            storage_path: media.storagePath || null,
            preview_path: media.previewPath || null,
            stream_path:  media.streamKey ? media.streamPath : null,
            video_path:   media.videoKey ? `videos/${releaseTypeFolder}/${slug}/` : null,
            image_path:   media.imageKey ? `images/${releaseTypeFolder}/${slug}/` : null,
            metadata: {
              release_type:     normalizeReleaseType(productType),
              release_category: productType,
              canonical:        false,
              r2_ingested:      true,
              ingested_from_r2_at: scannedAt,
            },
          });
          if (err) failed.push({ slug, type: productType, error: err });
          else productsUpserted += 1;
        }
      } catch (err) {
        failed.push({ slug, type: releaseTypeFolder, error: err?.message || "scan_failed" });
      }
    }
  }

  // ── Albums + mixtapes-and-eps ─────────────────────────────────────────────
  for (const releaseTypeFolder of ["mixtapes-and-eps", "albums"]) {
    const albumSlugs = await listR2Subfolders(`digital-assets/${releaseTypeFolder}`);
    const destArray = releaseTypeFolder === "mixtapes-and-eps" ? discovered.mixtapes : discovered.albums;

    for (const albumSlug of albumSlugs) {
      try {
        // Skip wizard releases that are not yet published — deactivate any stale product
        const { data: wizardRow } = await admin
          .from("releases").select("status").eq("slug", albumSlug).maybeSingle();
        if (wizardRow && wizardRow.status !== "published") {
          if (!dryRun) {
            await admin.from("products")
              .update({ active: false, updated_at: new Date().toISOString() })
              .eq("slug", albumSlug);
          }
          continue;
        }

        const [tracks, imageKey, videoKey] = await Promise.all([
          discoverAlbumTracks(albumSlug, releaseTypeFolder),
          discoverFile(`images/${releaseTypeFolder}/${albumSlug}`, [".jpg", ".jpeg", ".png", ".webp"]),
          discoverFile(`videos/${releaseTypeFolder}/${albumSlug}`, [".mp4", ".webm", ".mov"]),
        ]);
        destArray.push({ slug: albumSlug, title: titleFromSlug(albumSlug), releaseTypeFolder, trackCount: tracks.length, tracks, imageKey, videoKey });

        if (!dryRun) {
          const isEpMixtape = releaseTypeFolder === "mixtapes-and-eps";
          const productErr = await upsertProduct(admin, {
            slug:         albumSlug,
            title:        titleFromSlug(albumSlug),
            product_type: "album",
            price_cents:  DEFAULT_PRICE_CENTS[releaseTypeFolder],
            active:       true,
            release_type: releaseTypeFolder,
            storage_path: null,
            preview_path: null,
            stream_path:  null,
            video_path:   videoKey ? `videos/${releaseTypeFolder}/${albumSlug}/` : null,
            image_path:   imageKey ? `images/${releaseTypeFolder}/${albumSlug}/` : null,
            metadata: {
              release_type:     releaseTypeFolder,
              release_category: isEpMixtape ? "mixtape" : "album",
              canonical:        false,
              r2_ingested:      true,
              ingested_from_r2_at: scannedAt,
            },
          });
          if (productErr) {
            failed.push({ slug: albumSlug, type: releaseTypeFolder, error: productErr });
            continue;
          }
          productsUpserted += 1;

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

  return {
    ok: failed.length === 0,
    dryRun,
    discovered: {
      singles:  discovered.singles.map((r)  => ({ slug: r.slug, title: r.title, mediaFound: { audio: Boolean(r.media.audioKey), preview: Boolean(r.media.previewKey), stream: Boolean(r.media.streamKey), image: Boolean(r.media.imageKey), video: Boolean(r.media.videoKey) } })),
      features: discovered.features.map((r) => ({ slug: r.slug, title: r.title, mediaFound: { audio: Boolean(r.media.audioKey), preview: Boolean(r.media.previewKey), stream: Boolean(r.media.streamKey), image: Boolean(r.media.imageKey), video: Boolean(r.media.videoKey) } })),
      albums:   discovered.albums.map((r)   => ({ slug: r.slug, title: r.title, trackCount: r.trackCount, imageFound: Boolean(r.imageKey), videoFound: Boolean(r.videoKey) })),
      mixtapes: discovered.mixtapes.map((r) => ({ slug: r.slug, title: r.title, trackCount: r.trackCount, imageFound: Boolean(r.imageKey), videoFound: Boolean(r.videoKey) })),
    },
    summary: {
      singlesDiscovered:  discovered.singles.length,
      featuresDiscovered: discovered.features.length,
      albumsDiscovered:   discovered.albums.length,
      mixtapesDiscovered: discovered.mixtapes.length,
      productsUpserted:   dryRun ? 0 : productsUpserted,
      tracksUpserted:     dryRun ? 0 : tracksUpserted,
      failed:             failed.length,
    },
    failed,
    scannedAt,
  };
}
