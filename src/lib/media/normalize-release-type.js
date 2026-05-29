/** Re-export layer-2 utils + layer-1 constants (stable import path for callers). */
export { RELEASE_TYPES, RELEASE_TYPE_ALIASES, RELEASE_FOLDER } from "@/lib/media/constants/release-types";
export { normalizeReleaseType, isKnownReleaseType } from "@/lib/media/utils/normalize-release-type";
