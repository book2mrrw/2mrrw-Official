import { buildR2Key, R2_PREFIX } from "@/lib/storage/r2";

/**
 * Normalize control sync storage_path to canonical R2 key for products + playback.
 */
export function normalizeStoragePathForStorefront(path) {
  const normalized = String(path || "").trim().replace(/^\//, "");
  if (!normalized) return "";

  if (
    normalized.startsWith(`${R2_PREFIX.DIGITAL_ASSETS}/`) ||
    normalized.startsWith(`${R2_PREFIX.PROTECTED_MEDIA}/`)
  ) {
    return normalized;
  }

  if (normalized.startsWith("masters/") || normalized.startsWith("previews/")) {
    return buildR2Key(R2_PREFIX.PROTECTED_MEDIA, normalized);
  }

  return buildR2Key(R2_PREFIX.DIGITAL_ASSETS, normalized);
}
