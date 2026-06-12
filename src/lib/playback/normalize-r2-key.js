import { buildR2Key, R2_PREFIX } from "@/lib/storage/r2";

/**
 * Map a DB storage_path to a signed R2 object key.
 * WHY: Release masters live under protected-media; legacy commerce rows use digital-assets.
 */
export function normalizePlaybackR2Key(storagePath) {
  const normalized = String(storagePath || "").replace(/^\//, "");
  if (!normalized) return "";

  if (
    normalized.startsWith(`${R2_PREFIX.DIGITAL_ASSETS}/`) ||
    normalized.startsWith(`${R2_PREFIX.PROTECTED_MEDIA}/`)
  ) {
    return normalized;
  }

  if (normalized.startsWith("protected-media/")) {
    return normalized;
  }

  if (normalized.startsWith("masters/") || normalized.startsWith("previews/")) {
    return buildR2Key(R2_PREFIX.PROTECTED_MEDIA, normalized);
  }

  return buildR2Key(R2_PREFIX.DIGITAL_ASSETS, normalized);
}
