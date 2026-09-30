/**
 * Vault audio contract.
 *
 * Vault sections like Audio Diariez, Private Releasez and UNMXD UNMSTRD are
 * audio, and they need what a song release gets: a lossless master uploaded
 * once, transcoded into an encrypted HLS ladder, and streamed under an
 * entitlement gate -- not a raw file handed out behind a signed URL.
 *
 * Separate from the release audio pipeline in every layer this file can
 * control:
 *
 *   - Its own routes (/api/admin/vault/audio/*, /api/vault/audio/*). Nothing
 *     here calls /api/admin/upload/* or /api/library/hls/*.
 *   - Its own R2 prefixes. Masters under videos/vault/_audio-masters/,
 *     HLS output under hls/vault/. A release's hls/<releaseType>/ tree is
 *     never written to.
 *   - Its own token namespace (vault-audio-token.js: vault_a / vault_ak), so
 *     a release stream token cannot be replayed here or vice versa.
 *   - Its own rendition list, below. Deliberately NOT imported from
 *     lib/hls/audio-renditions.js: the values are identical today, and
 *     duplicating four strings is the price of guaranteeing that retuning the
 *     release ladder can never silently retune the Vault's.
 *
 * The one thing it shares is the transcode queue itself -- a row in
 * hls_transcode_jobs with job_type 'audio', which the existing Fly worker
 * lane claims and processes. That worker is generic: transcode() reads only
 * slug, source_key, hls_prefix and bitrates off the job row and writes
 * segments to hls_prefix. It never looks up a release. This is the same
 * arrangement Audio Visualz already runs under (its own table, own routes,
 * own prefix, job_type 'video' in the shared queue), and it needs no worker
 * change, no migration, and no second Fly deployment.
 */

import { folderForCategory, VAULT_SLUG_RE } from "./vault-upload-contract.js";

/**
 * Sections whose contents are audio by nature, so the manager opens in audio
 * mode for them. Not a restriction: an audio master may be attached to an
 * item in any section -- media_type lives per item, not per section.
 */
export const AUDIO_NATIVE_CATEGORIES = Object.freeze([
  "Audio Diariez",
  "Private Releasez",
  "UNMXD UNMSTRD",
]);

export function isAudioNativeCategory(category) {
  return AUDIO_NATIVE_CATEGORIES.includes(category);
}

/**
 * The encrypted AAC-LC ladder a vault audio item is published at.
 *
 * Same four rungs the release pipeline uses, for the same reason: 64k is the
 * data-saver floor that stays inside AAC-LC's quality-preserving range, and
 * going below it trades stalls for audible artifacts. Held as its own frozen
 * list -- see this file's header on why it is not imported.
 */
export const VAULT_AUDIO_RENDITIONS = Object.freeze(["320k", "160k", "96k", "64k"]);

/** Matches the worker's -hls_time. Changing it desyncs EXT-X-TARGETDURATION. */
export const VAULT_AUDIO_SEGMENT_SECONDS = 6;

/**
 * Written into hls_transcode_jobs.release_type. Not a release type -- the
 * column is how this row says which tree its output belongs to, and 'vault'
 * keeps vault segments out of every hls/<releaseType>/ prefix.
 */
export const VAULT_AUDIO_RELEASE_TYPE = "vault";

/**
 * Accepted master formats. Lossless first -- a master is the archival copy
 * every future re-encode is derived from, so accepting a lossy file means
 * transcoding a transcode. mp3/m4a are allowed because a voice memo diary
 * entry often only ever existed as one, and refusing it would mean refusing
 * the content rather than the format.
 */
export const VAULT_AUDIO_MASTER_KINDS = Object.freeze({
  wav:  "audio/wav",
  wave: "audio/wav",
  flac: "audio/flac",
  aif:  "audio/aiff",
  aiff: "audio/aiff",
  alac: "audio/mp4",
  m4a:  "audio/mp4",
  mp3:  "audio/mpeg",
});

/** A lossless hour of stereo 24/96 runs past 1GB, so the ceiling is generous. */
export const VAULT_AUDIO_MASTER_MAX_BYTES = 2_000_000_000;

/** Above this the browser uploads in parts instead of one PUT. */
export const VAULT_AUDIO_MULTIPART_THRESHOLD_BYTES = 100_000_000;

export const VAULT_AUDIO_ACCEPT =
  "audio/wav,audio/flac,audio/aiff,audio/mp4,audio/mpeg,.wav,.wave,.flac,.aif,.aiff,.alac,.m4a,.mp3";

/** Formats turned away at the door, with the reason and the fix, rather than
 *  accepted and left to fail inside ffmpeg an hour later. */
export const REJECTED_AUDIO_MASTER_EXTENSIONS = Object.freeze({
  ogg:  ".ogg is not a master format here. Export as .wav or .flac.",
  opus: ".opus is a delivery codec, not a master. Export as .wav or .flac.",
  wma:  ".wma will not decode in this pipeline. Export as .wav or .flac.",
  aac:  "A bare .aac stream has no reliable duration. Export as .m4a, .wav or .flac.",
  mid:  ".mid is a score, not audio. Bounce it to .wav first.",
  midi: ".midi is a score, not audio. Bounce it to .wav first.",
});

function safeExt(ext) {
  return String(ext || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function audioExtensionForFilename(filename) {
  const parts = String(filename || "").split(".");
  if (parts.length < 2) return "";
  return safeExt(parts.pop());
}

/**
 * Where the master lands.
 *
 * Under videos/vault/, which is in R2_NEVER_PUBLIC_PREFIXES -- a master is
 * never served to anyone, only read once by the worker. The leading
 * underscore on _audio-masters keeps it out of the per-section item folders
 * the listing walks, the same way _section-covers does.
 */
export function buildVaultAudioMasterKey({ category, slug, ext }) {
  const folder = folderForCategory(category);
  if (!folder) return null;
  // The same slug rule the rest of the vault uses, imported rather than
  // restated: these strings become object keys, so the two drifting apart
  // would be a path-traversal gap, not a formatting inconsistency.
  if (!VAULT_SLUG_RE.test(String(slug || ""))) return null;
  const e = safeExt(ext);
  if (!e) return null;
  return `videos/vault/_audio-masters/${folder}/${slug}.${e}`;
}

/**
 * Where the encrypted ladder lands.
 *
 * Under hls/, not videos/vault/: segments are AES-128 encrypted and served
 * from the public CDN exactly like release segments, because without the key
 * they are noise. The key itself comes from an auth-gated endpoint. Putting
 * them behind signed URLs instead would defeat CDN caching for no security
 * gain.
 *
 * The vault/ path component is what keeps this out of every
 * hls/<releaseType>/ tree.
 */
export function buildVaultAudioHlsPrefix({ category, slug }) {
  const folder = folderForCategory(category);
  if (!folder) return null;
  if (!VAULT_SLUG_RE.test(String(slug || ""))) return null;
  return `hls/vault/${folder}/${slug}/`;
}

export function validateVaultAudioMaster({ category, slug, filename, size }) {
  if (!folderForCategory(category)) return { error: "Unknown vault section" };

  const ext = audioExtensionForFilename(filename);
  if (!ext) return { error: "File has no extension" };
  if (REJECTED_AUDIO_MASTER_EXTENSIONS[ext]) {
    return { error: REJECTED_AUDIO_MASTER_EXTENSIONS[ext] };
  }
  const contentType = VAULT_AUDIO_MASTER_KINDS[ext];
  if (!contentType) {
    return { error: `.${ext} is not a supported master format. Use .wav, .flac, .aiff, .m4a or .mp3.` };
  }

  const bytes = Number(size);
  if (!Number.isFinite(bytes) || bytes <= 0) return { error: "Missing file size" };
  if (bytes > VAULT_AUDIO_MASTER_MAX_BYTES) {
    return { error: `Too large — max ${VAULT_AUDIO_MASTER_MAX_BYTES / 1e9}GB for an audio master` };
  }

  const key = buildVaultAudioMasterKey({ category, slug, ext });
  const hlsPrefix = buildVaultAudioHlsPrefix({ category, slug });
  if (!key || !hlsPrefix) return { error: "Could not build storage key" };

  return { ext, key, hlsPrefix, bytes, contentType, lossless: ext !== "mp3" && ext !== "m4a" };
}
