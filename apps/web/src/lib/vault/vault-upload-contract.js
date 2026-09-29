/**
 * Vault Manager upload contract.
 *
 * The single source of truth for where Vault uploads land and what is allowed
 * through. Deliberately separate from lib/media/admin-upload-contract.js:
 * that one is the release/audio pipeline, keyed on release types
 * (singles/albums/mixtapes-and-eps), and nothing here shares a code path with
 * it.
 *
 * The category strings below are the exact `vault_content.category` values
 * already live in the database, and the folders are the exact R2 prefixes
 * already in use. Renaming either side without the other breaks the mapping
 * between a row and its media, so they are pinned together here rather than
 * being typed out at each call site.
 */

export const VAULT_SECTIONS = Object.freeze([
  { category: "Audio Diariez", folder: "audio-diariez" },
  { category: "Behind the Scenez", folder: "behind-the-scenez" },
  { category: "Exclusive Interviewz", folder: "exclusive-interviewz" },
  { category: "Live Replayz", folder: "live-replayz" },
  { category: "Archive Sessionz", folder: "archive-sessionz" },
  { category: "True Storiez", folder: "true-storiez" },
  { category: "Private Releasez", folder: "private-releasez" },
  { category: "UNMXD UNMSTRD", folder: "unmxd-unmstrd" },
]);

const FOLDER_BY_CATEGORY = new Map(VAULT_SECTIONS.map((s) => [s.category, s.folder]));

export function folderForCategory(category) {
  return FOLDER_BY_CATEGORY.get(category) || null;
}

/** Mirrors the vault_content CHECK constraints so a bad value is rejected
 *  before it reaches Postgres and comes back as an opaque 500. */
export const MEDIA_TYPES = Object.freeze([
  "audio", "video", "image", "text", "mixed", "schedule", "archive", "commentary",
]);
export const ACCESS_TIERS = Object.freeze(["public", "inner_circle", "vault_pass"]);
export const VISIBILITIES = Object.freeze(["draft", "scheduled", "published", "archived"]);

/** Accepted upload kinds. Caps are generous for video because a vault drop is
 *  often a long-form recording straight off a phone. */
export const VAULT_UPLOAD_KINDS = Object.freeze({
  video: {
    maxBytes: 5_000_000_000,
    mimePrefixes: ["video/"],
    extensions: ["mp4", "mov", "m4v", "webm"],
  },
  audio: {
    maxBytes: 2_000_000_000,
    mimePrefixes: ["audio/"],
    extensions: ["mp3", "m4a", "wav", "aac", "flac"],
  },
  image: {
    maxBytes: 50_000_000,
    mimePrefixes: ["image/"],
    extensions: ["jpg", "jpeg", "png", "webp", "avif", "heic"],
  },
});

/** Anything at or above this goes through multipart rather than a single PUT.
 *  A phone video will routinely cross it. */
export const MULTIPART_THRESHOLD_BYTES = 100_000_000;

/** Slugs become part of an object key, so this is a path-traversal guard as
 *  much as a formatting rule: lowercase, no dots, no slashes, no leading or
 *  trailing dashes. */
export const VAULT_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

export function slugify(input) {
  return String(input || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
}

export function extensionForFilename(filename) {
  const parts = String(filename || "").split(".");
  if (parts.length < 2) return "";
  return parts.pop().toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function kindForUpload({ mimeType, filename }) {
  const ext = extensionForFilename(filename);
  for (const [kind, rules] of Object.entries(VAULT_UPLOAD_KINDS)) {
    const mimeOk = rules.mimePrefixes.some((p) => String(mimeType || "").startsWith(p));
    if (mimeOk || rules.extensions.includes(ext)) return kind;
  }
  return null;
}

/**
 * The one place a Vault object key is built.
 *
 * `videos/vault/**` is entitlement-gated and listed in
 * R2_NEVER_PUBLIC_PREFIXES, so it must never pick up a public Cache-Control.
 * It sits under `videos/` only by folder convention -- the blanket `videos/`
 * public rule would otherwise sweep it in.
 */
export function buildVaultKey({ category, slug, ext }) {
  const folder = folderForCategory(category);
  if (!folder) return null;
  if (!VAULT_SLUG_RE.test(String(slug || ""))) return null;
  const safeExt = String(ext || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!safeExt) return null;
  return `videos/vault/${folder}/${slug}.${safeExt}`;
}

/** Shared validation so the presign and complete routes cannot disagree about
 *  what counts as an acceptable upload. */
export function validateUploadRequest({ category, slug, filename, mimeType, size }) {
  if (!folderForCategory(category)) return { error: "Unknown vault section" };
  if (!VAULT_SLUG_RE.test(String(slug || ""))) return { error: "Invalid slug" };

  const kind = kindForUpload({ mimeType, filename });
  if (!kind) return { error: "Unsupported file type" };

  const ext = extensionForFilename(filename);
  if (!VAULT_UPLOAD_KINDS[kind].extensions.includes(ext)) {
    return { error: `Unsupported .${ext || "?"} for ${kind}` };
  }

  const bytes = Number(size);
  if (!Number.isFinite(bytes) || bytes <= 0) return { error: "Missing file size" };
  if (bytes > VAULT_UPLOAD_KINDS[kind].maxBytes) {
    return { error: `Too large for ${kind} (max ${VAULT_UPLOAD_KINDS[kind].maxBytes / 1e9}GB)` };
  }

  const key = buildVaultKey({ category, slug, ext });
  if (!key) return { error: "Could not build storage key" };

  return { kind, ext, key, bytes };
}
