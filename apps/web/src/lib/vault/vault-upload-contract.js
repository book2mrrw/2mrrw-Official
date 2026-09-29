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

/* --- section covers -------------------------------------------------------
   The still or short loop a pod shows on its shelf before it is summoned, so
   a section is never sitting there blank.

   A third isolated contract alongside `cover` and `av-cover`, following the
   precedent Audio Visualz set: same proven shape, its own entry, its own R2
   prefix, no shared code path with either. Nothing here reaches
   lib/media/admin-upload-contract.js or /api/admin/upload/*.

   Formats are restricted to what browsers will actually play rather than
   what sounds accommodating:

   - .mov is a QuickTime container. Chrome and Firefox generally will not
     decode it, and resolveCoverMediaType() does not even recognise it as
     video. The existing cover-video contract accepts .mov and then silently
     fails to play it; that trap is not repeated here.
   - .gif animates without a decoder but costs 10-50x the bytes of an
     equivalent mp4 for worse quality, and these play on a shelf behind a
     vault door on a phone.

   Both are rejected at the door with a message saying what to export
   instead, because a file that uploads and then does not play is worse than
   one that was never accepted. */
export const SECTION_COVER_KINDS = Object.freeze({
  still: {
    maxBytes: 20_000_000,
    extensions: { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" },
  },
  motion: {
    maxBytes: 200_000_000,
    maxDurationSeconds: 30,
    extensions: { mp4: "video/mp4", webm: "video/webm" },
  },
});

/** Extensions we deliberately turn away, with the reason and the fix. */
export const REJECTED_COVER_EXTENSIONS = Object.freeze({
  mov: ".mov is a QuickTime container that most browsers will not play. Export as .mp4.",
  gif: ".gif is many times larger than the same clip as .mp4, for worse quality. Export as .mp4.",
  avi: ".avi will not play in a browser. Export as .mp4.",
  mkv: ".mkv will not play in a browser. Export as .mp4.",
  heic: ".heic is not supported by most browsers. Export as .jpg or .webp.",
});

export const SECTION_COVER_ACCEPT =
  "video/mp4,video/webm,image/jpeg,image/png,image/webp,.mp4,.webm,.jpg,.jpeg,.png,.webp";

/** Section covers live beside the content they belong to, still inside the
 *  never-public prefix. One fixed name per section per kind, so replacing a
 *  cover overwrites rather than accumulating orphans. */
export function buildSectionCoverKey({ category, kind, ext }) {
  const folder = folderForCategory(category);
  if (!folder) return null;
  if (kind !== "still" && kind !== "motion") return null;
  const safeExt = String(ext || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!safeExt) return null;
  return `videos/vault/_section-covers/${folder}-${kind}.${safeExt}`;
}

export function validateSectionCover({ category, filename, size }) {
  if (!folderForCategory(category)) return { error: "Unknown vault section" };

  const ext = extensionForFilename(filename);
  if (!ext) return { error: "File has no extension" };
  if (REJECTED_COVER_EXTENSIONS[ext]) return { error: REJECTED_COVER_EXTENSIONS[ext] };

  let kind = null;
  if (SECTION_COVER_KINDS.still.extensions[ext]) kind = "still";
  else if (SECTION_COVER_KINDS.motion.extensions[ext]) kind = "motion";
  if (!kind) {
    return { error: `.${ext} is not a supported cover format. Use .mp4, .webm, .jpg, .png or .webp.` };
  }

  const rules = SECTION_COVER_KINDS[kind];
  const bytes = Number(size);
  if (!Number.isFinite(bytes) || bytes <= 0) return { error: "Missing file size" };
  if (bytes > rules.maxBytes) {
    return { error: `Too large — max ${Math.round(rules.maxBytes / 1_000_000)}MB for a ${kind} cover` };
  }

  const key = buildSectionCoverKey({ category, kind, ext });
  if (!key) return { error: "Could not build storage key" };

  return { kind, ext, key, bytes, contentType: rules.extensions[ext] };
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
