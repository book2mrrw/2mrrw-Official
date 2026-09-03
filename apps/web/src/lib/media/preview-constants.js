/**
 * Fixed preview clip length used by the admin upload wizard when deriving a
 * preview from the master. Intentionally NOT imported from the playback
 * engine (PREVIEW_HARD_CAP_SEC in PlaybackEventHandlers.js) — the admin
 * upload UI must never import from or couple to playback-runtime code.
 * Keep this value in sync with PREVIEW_HARD_CAP_SEC by convention.
 */
export const PREVIEW_CLIP_SECONDS = 15;
