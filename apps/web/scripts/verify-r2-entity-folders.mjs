#!/usr/bin/env node
/**
 * Read-only R2 entity-folder probe for canonical catalog releases.
 *
 * Usage:
 *   node scripts/verify-r2-entity-folders.mjs
 *   node scripts/verify-r2-entity-folders.mjs --json
 *
 * Requires CLOUDFLARE_R2_* in .env.local (or env). Skips live probe when absent.
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const jsonOut = process.argv.includes("--json");

const CANONICAL_SINGLES = [
  { slug: "hour-glass", release_type: "single" },
  { slug: "turnt-me-2-dis", release_type: "single" },
  { slug: "w2d", release_type: "single" },
  { slug: "artificial", release_type: "single" },
];

const CANONICAL_FEATURES = [
  {
    slug: "i-dont-believe-you",
    release_type: "feature",
    preview_legacy: "previews/features/i-dont-believe-you/i-dont-believe-you-preview.wav",
  },
  {
    slug: "2-heavy",
    release_type: "feature",
    preview_legacy: "previews/features/2-heavy/2-heavy-preview.wav",
  },
];

const CANONICAL_ALBUMS = [
  { slug: "love-hz-vol-1", release_type: "ep" },
  { slug: "ad", release_type: "mixtape" },
  { slug: "tbh", release_type: "mixtape" },
];

const CANONICAL_TRACKS = [
  { album_slug: "love-hz-vol-1", slug: "01-roll-call" },
  { album_slug: "love-hz-vol-1", slug: "02-w-2-d" },
  { album_slug: "love-hz-vol-1", slug: "03-guarded-heart" },
  { album_slug: "love-hz-vol-1", slug: "04-all-love-it" },
  { album_slug: "love-hz-vol-1", slug: "05-like-u-do" },
  { album_slug: "love-hz-vol-1", slug: "06-tell-me" },
  { album_slug: "love-hz-vol-1", slug: "07-stayed-2-long" },
  { album_slug: "love-hz-vol-1", slug: "08-knock-on-wood" },
  { album_slug: "love-hz-vol-1", slug: "09-hour-glass" },
  { album_slug: "love-hz-vol-1", slug: "10-turnt-me-2-dis" },
  { album_slug: "ad", slug: "01-2mrrws-ntro" },
  { album_slug: "ad", slug: "02-here-i-come" },
  { album_slug: "ad", slug: "03-said-n-done" },
  { album_slug: "ad", slug: "04-a-d-d" },
  { album_slug: "ad", slug: "05-perspective" },
  { album_slug: "ad", slug: "06-grand-scheme" },
  { album_slug: "ad", slug: "07-a2b" },
  { album_slug: "ad", slug: "08-life-changes-ft-gwendolyn" },
  { album_slug: "ad", slug: "09-itself" },
  { album_slug: "ad", slug: "10-wastin-time" },
  { album_slug: "ad", slug: "11-like-me-or-not" },
  { album_slug: "tbh", slug: "01-glass-full" },
  { album_slug: "tbh", slug: "02-up-2-me" },
  { album_slug: "tbh", slug: "03-unxpcted" },
  { album_slug: "tbh", slug: "04-all-yours" },
  { album_slug: "tbh", slug: "05-locomotive" },
  { album_slug: "tbh", slug: "06-left" },
  { album_slug: "tbh", slug: "07-was-wrong" },
  { album_slug: "tbh", slug: "08-2late" },
  { album_slug: "tbh", slug: "09-artificial" },
];

const RELEASE_FOLDER = {
  single: "singles",
  feature: "features",
  ep: "mixtapes-and-eps",
  mixtape: "mixtapes-and-eps",
  album: "albums",
};

function resolveStoragePath(releaseType, releaseSlug, trackSlug) {
  const folder = RELEASE_FOLDER[releaseType] || RELEASE_FOLDER.single;
  const release = releaseSlug;
  if (folder === "mixtapes-and-eps") {
    const track = trackSlug;
    if (!track) return "";
    return `digital-assets/${folder}/${release}/${track}/`;
  }
  return `digital-assets/${folder}/${release}/`;
}

function resolveArtworkPath(releaseType, slug, trackSlug, albumSlug) {
  const folder = RELEASE_FOLDER[releaseType] || RELEASE_FOLDER.single;
  if (folder === "mixtapes-and-eps" || folder === "albums") {
    const album = albumSlug || slug;
    const track = albumSlug ? slug : trackSlug;
    if (albumSlug && track) return `images/${folder}/${album}/${track}/`;
    return `images/${folder}/${slug}/`;
  }
  return `images/${folder}/${slug}/`;
}

function resolvePreviewPath(releaseType, slug, albumSlug) {
  const folder = RELEASE_FOLDER[releaseType] || RELEASE_FOLDER.single;
  if (folder === "mixtapes-and-eps") {
    const album = albumSlug || slug;
    const track = albumSlug ? slug : null;
    if (albumSlug && track) return `previews/${folder}/${album}/${track}/`;
    return `previews/${folder}/${slug}/`;
  }
  return `previews/${folder}/${slug}/`;
}

function resolveVideoPath(releaseType, slug, trackSlug, albumSlug) {
  const folder = RELEASE_FOLDER[releaseType] || RELEASE_FOLDER.single;
  if (folder === "mixtapes-and-eps" || folder === "albums") {
    const album = albumSlug || slug;
    const track = albumSlug ? slug : trackSlug;
    if (albumSlug && track) return `videos/${folder}/${album}/${track}/`;
    return `videos/${folder}/${slug}/`;
  }
  return `videos/${folder}/${slug}/`;
}

function loadEnvLocal() {
  const path = join(root, ".env.local");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i <= 0) continue;
    const key = trimmed.slice(0, i).trim();
    const val = trimmed.slice(i + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = val;
  }
}

loadEnvLocal();

const AUDIO_EXTENSIONS = [".wav", ".flac", ".m4a", ".mp3"];
const ARTWORK_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"];
const VIDEO_EXTENSIONS = [".mp4", ".webm", ".mov"];

function hasExtension(keys, extensions) {
  const lower = keys.map((k) => k.toLowerCase());
  return extensions.some((ext) => lower.some((k) => k.endsWith(ext)));
}

function isDirectChildKey(folderPrefix, key) {
  const listPrefix = String(folderPrefix || "")
    .replace(/^\//, "")
    .replace(/\/?$/, "/");
  const normalizedKey = String(key || "").replace(/^\//, "");
  if (!listPrefix || !normalizedKey.startsWith(listPrefix)) return false;
  const remainder = normalizedKey.slice(listPrefix.length);
  return remainder.length > 0 && !remainder.includes("/");
}

/** List only direct child files under an entity folder (non-recursive). */
async function listPrefix(client, bucket, prefix) {
  const normalized = String(prefix || "").replace(/^\//, "");
  if (!normalized) return [];
  const listPrefix = normalized.endsWith("/") ? normalized : `${normalized}/`;
  const keys = [];
  let continuationToken;
  do {
    const res = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: listPrefix,
        Delimiter: "/",
        ContinuationToken: continuationToken,
      })
    );
    for (const item of res.Contents || []) {
      if (item?.Key && !item.Key.endsWith("/") && isDirectChildKey(listPrefix, item.Key)) {
        keys.push(item.Key);
      }
    }
    continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (continuationToken);
  return keys;
}

function buildEntities() {
  const entities = [];
  for (const release of [...CANONICAL_SINGLES, ...CANONICAL_FEATURES]) {
    const type = release.release_type || "single";
    entities.push({
      slug: release.slug,
      kind: type,
      audio: resolveStoragePath(type, release.slug),
      preview: resolvePreviewPath(type, release.slug),
      artwork: resolveArtworkPath(type, release.slug),
      video: resolveVideoPath(type, release.slug),
      legacyPreview: release.preview_legacy || null,
    });
  }
  for (const album of CANONICAL_ALBUMS) {
    const type = album.release_type || "album";
    entities.push({
      slug: album.slug,
      kind: "album",
      audio: null,
      preview: null,
      artwork: resolveArtworkPath(type, album.slug),
      video: null,
    });
  }
  for (const track of CANONICAL_TRACKS) {
    const album = CANONICAL_ALBUMS.find((a) => a.slug === track.album_slug);
    const type = album?.release_type || "album";
    entities.push({
      slug: `${track.album_slug}/${track.slug}`,
      kind: "album_track",
      audio: resolveStoragePath(type, track.album_slug, track.slug),
      preview: resolvePreviewPath(type, track.slug, track.album_slug),
      artwork: resolveArtworkPath(type, track.slug, track.album_slug),
      video: resolveVideoPath(type, track.slug, track.album_slug),
    });
  }
  return entities;
}

async function main() {
  const bucket = process.env.CLOUDFLARE_R2_BUCKET_NAME;
  const endpoint = process.env.CLOUDFLARE_R2_ENDPOINT;
  const accessKeyId = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;

  const entities = buildEntities();
  const expectedFailures = [
    { slug: "i-dont-believe-you", note: "Prior audit: master at digital-assets/singles/… (404 public CDN)" },
    { slug: "2-heavy", note: "Prior audit: master at digital-assets/singles/… (404 public CDN)" },
    { slug: "features/*", note: "DB uses features/; R2 may store under singles/ — code fallback added" },
  ];

  if (!bucket || !endpoint || !accessKeyId || !secretAccessKey) {
    const report = { skipped: true, reason: "CLOUDFLARE_R2_* not configured", entityCount: entities.length, expectedFailures };
    if (jsonOut) console.log(JSON.stringify(report, null, 2));
    else {
      console.log("verify-r2-entity-folders: SKIP — set CLOUDFLARE_R2_* in .env.local");
      console.log(`Canonical entities to probe: ${entities.length}`);
      for (const row of expectedFailures) console.log(`  - ${row.slug}: ${row.note}`);
    }
    process.exit(0);
  }

  const client = new S3Client({ region: "auto", endpoint, credentials: { accessKeyId, secretAccessKey } });
  const results = [];

  for (const entity of entities) {
    const row = {
      slug: entity.slug,
      kind: entity.kind,
      audio: { prefix: entity.audio, keys: [], hasAudio: false },
      preview: { prefix: entity.preview, keys: [], hasPreview: false },
      artwork: { prefix: entity.artwork, keys: [], hasArtwork: false },
      video: { prefix: entity.video, keys: [], hasVideo: false },
      legacyPreview: entity.legacyPreview,
    };

    if (entity.audio) {
      row.audio.keys = await listPrefix(client, bucket, entity.audio);
      row.audio.hasAudio = hasExtension(row.audio.keys, AUDIO_EXTENSIONS);
      if (!row.audio.hasAudio && entity.kind === "feature") {
        const singlesFallback = entity.audio.replace(/\/features\//, "/singles/");
        if (singlesFallback !== entity.audio) {
          const altKeys = await listPrefix(client, bucket, singlesFallback);
          if (hasExtension(altKeys, AUDIO_EXTENSIONS)) {
            row.audio.singlesFallbackPrefix = singlesFallback;
            row.audio.hasAudioViaSinglesFallback = true;
          }
        }
      }
    }
    if (entity.preview) {
      row.preview.keys = await listPrefix(client, bucket, entity.preview);
      row.preview.hasPreview = hasExtension(row.preview.keys, AUDIO_EXTENSIONS);
    }
    if (entity.artwork) {
      row.artwork.keys = await listPrefix(client, bucket, entity.artwork);
      row.artwork.hasArtwork = hasExtension(row.artwork.keys, ARTWORK_EXTENSIONS);
    }
    if (entity.video) {
      row.video.keys = await listPrefix(client, bucket, entity.video);
      row.video.hasVideo = hasExtension(row.video.keys, VIDEO_EXTENSIONS);
    }
    results.push(row);
  }

  const summary = {
    skipped: false,
    bucket,
    probed: results.length,
    withAudio: results.filter((r) => r.audio.hasAudio || r.audio.hasAudioViaSinglesFallback).length,
    withPreview: results.filter((r) => r.preview.hasPreview).length,
    withArtwork: results.filter((r) => r.artwork.hasArtwork).length,
    withVideo: results.filter((r) => r.video.hasVideo).length,
    missingAudio: results
      .filter((r) => r.audio.prefix && !r.audio.hasAudio && !r.audio.hasAudioViaSinglesFallback)
      .map((r) => r.slug),
    singlesFallbackHits: results.filter((r) => r.audio.hasAudioViaSinglesFallback).map((r) => r.slug),
    expectedFailures,
    results,
  };

  if (jsonOut) console.log(JSON.stringify(summary, null, 2));
  else {
    console.log(`R2 probe — bucket: ${bucket}`);
    console.log(`Entities: ${summary.probed} | audio: ${summary.withAudio} | preview: ${summary.withPreview} | artwork: ${summary.withArtwork} | video: ${summary.withVideo}`);
    if (summary.missingAudio.length) {
      console.log("\nMissing audio:");
      for (const slug of summary.missingAudio) console.log(`  - ${slug}`);
    }
    if (summary.singlesFallbackHits.length) {
      console.log("\nAudio via singles/ fallback:");
      for (const slug of summary.singlesFallbackHits) console.log(`  - ${slug}`);
    }
  }
}

main().catch((err) => {
  console.error("verify-r2-entity-folders failed:", err?.message || err);
  process.exit(1);
});
