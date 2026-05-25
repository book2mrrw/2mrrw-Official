/** Framer springs for immersive modal surfaces (restrained, no layoutId on artwork). */
export const MODAL_DRAWER_SPRING = { type: "spring", stiffness: 340, damping: 36 };
export const MODAL_STAGE_ENTER = { duration: 0.5, ease: [0.22, 1, 0.36, 1], delay: 0.12 };
export const MODAL_PANEL_ENTER = { delay: 0.42, duration: 0.35 };

/** Preview UX cap for scrub display when stream is preview-only (audio file may already be clipped). */
export const PREVIEW_DISPLAY_CAP_SEC = 30;
