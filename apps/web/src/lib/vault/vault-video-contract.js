/**
 * Vault video contract.
 *
 * Vault video has had playback routes since it was first scoped
 * (/api/vault/video/{manifest,variant,key}) but nothing to feed them, so an
 * item fell back to a signed direct URL: the whole file over one connection,
 * no ladder, no encryption.
 *
 * This lane fills that gap. It does NOT reuse job_type='video': that lane is
 * bound to Audio Visualz -- it requires an asset_version_id, loads
 * audio_visual_asset_versions and audio_visuals, and writes
 * audio_visual_renditions. Vault content has none of those and should never
 * acquire them.
 *
 * The output shape is dictated by the routes that already read it.
 * /api/vault/video/variant builds `<prefix><bitrate>/seg_NNNNN.ts` and an
 * #EXT-X-KEY whose IV comes from the content slug, so this lane produces
 * AES-128 MPEG-TS exactly like the vault audio lane, not the fMP4-and-UUIDs
 * that Audio Visualz produces. Matching the consumer is what makes playback
 * work with no route changes.
 */

import { folderForCategory, VAULT_SLUG_RE } from "./vault-upload-contract.js";
import { VAULT_RELEASE_TYPE } from "./vault-job-identity.js";

export { VAULT_RELEASE_TYPE as VAULT_VIDEO_RELEASE_TYPE };

/**
 * The ladder.
 *
 * The bitrate strings are the identity each rung is stored and requested
 * under, and they are not free to choose: /api/vault/video/manifest maps
 * exactly these four to BANDWIDTH values for its master playlist, and a rung
 * it does not recognise is dropped from the playlist entirely.
 *
 * Heights are 16:9 reference points; the encoder scales to height and keeps
 * the source's aspect, so a vertical phone video ladders down just as well.
 */
export const VAULT_VIDEO_LADDER = Object.freeze([
  { bitrate: "4000k", height: 1080, maxrate: "4400k", bufsize: "8000k", audio: "128k" },
  { bitrate: "2000k", height: 720,  maxrate: "2200k", bufsize: "4000k", audio: "128k" },
  { bitrate: "1000k", height: 540,  maxrate: "1100k", bufsize: "2000k", audio: "96k"  },
  { bitrate: "720k",  height: 360,  maxrate: "800k",  bufsize: "1600k", audio: "96k"  },
]);

export const VAULT_VIDEO_RENDITIONS = Object.freeze(VAULT_VIDEO_LADDER.map((r) => r.bitrate));

/** Matches the variant route's EXT-X-TARGETDURATION default. */
export const VAULT_VIDEO_SEGMENT_SECONDS = 6;

/**
 * Where the encrypted ladder lands.
 *
 * Identical in shape to the audio lane's prefix, and safe to be: a
 * vault_content slug is unique across the whole table and an item has exactly
 * one media_type, so an audio item and a video item can never contend for the
 * same prefix.
 */
export function buildVaultVideoHlsPrefix({ category, slug }) {
  const folder = folderForCategory(category);
  if (!folder) return null;
  if (!VAULT_SLUG_RE.test(String(slug || ""))) return null;
  return `hls/vault/${folder}/${slug}/`;
}

/**
 * The ladder to actually encode for a given source height.
 *
 * Rungs taller than the source are upscaling -- more bytes carrying no extra
 * detail -- so they are excluded. But plain truncation wastes a source that
 * sits between rungs: a 480p phone clip has every rung above 360p dropped and
 * streams at 360p, below what was shot. So the first rung above the source is
 * kept too and encoded at the source's own height, giving a near-native top
 * rung alongside the smaller ones.
 *
 * Each entry carries `encodeHeight`, which is what the encoder scales to and
 * is never above the source.
 *
 * @returns {Array<{bitrate:string,height:number,encodeHeight:number,maxrate:string,bufsize:string,audio:string}>}
 */
export function ladderForSourceHeight(sourceHeight) {
  const h = Math.floor(Number(sourceHeight));
  if (!Number.isFinite(h) || h <= 0) {
    return VAULT_VIDEO_LADDER.map((r) => ({ ...r, encodeHeight: r.height }));
  }

  const atOrBelow = VAULT_VIDEO_LADDER.filter((r) => r.height <= h);
  // Only when the source sits *between* rungs. If it lands exactly on one, that
  // rung already covers its native height and adding the one above would encode
  // the same resolution twice at two bitrates -- double the work for a rung
  // nobody gains from.
  const sitsBetween = !VAULT_VIDEO_LADDER.some((r) => r.height === h);
  const firstAbove = sitsBetween
    ? [...VAULT_VIDEO_LADDER].reverse().find((r) => r.height > h)
    : null;

  const chosen = [];
  if (firstAbove) chosen.push({ ...firstAbove, encodeHeight: evenHeight(h) });
  for (const r of atOrBelow) chosen.push({ ...r, encodeHeight: r.height });

  // Highest bitrate first, matching the ladder's own order.
  chosen.sort(
    (a, b) =>
      VAULT_VIDEO_LADDER.findIndex((r) => r.bitrate === a.bitrate) -
      VAULT_VIDEO_LADDER.findIndex((r) => r.bitrate === b.bitrate)
  );
  return chosen;
}

/** H.264 requires even dimensions; an odd source height fails to encode. */
function evenHeight(h) {
  return h % 2 === 0 ? h : h - 1;
}
