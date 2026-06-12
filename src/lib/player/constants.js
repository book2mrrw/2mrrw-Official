/** Shared motion + gesture constants for immersive player surfaces */

export const PLAYER_LAYOUT_ID = "immersive-player-artwork";

export const PLAYER_SPRING = { type: "spring", stiffness: 320, damping: 34 };
export const PLAYER_SPRING_EXIT = { type: "spring", stiffness: 380, damping: 36 };

export const DOUBLE_TAP_MS = 300;
export const HOLD_FADE_MS = 300;
export const RELEASE_FADE_MS = 200;
export const MOVE_CANCEL_PX = 10;
export const SWIPE_DISMISS_PX = 80;
export const EXPAND_SWIPE_CLOSE_MS = 220;

export const CS_PLAYBACK_RATE = 0.75;

export const PLAYER_BODY_CLASS = {
  active: "is-player-active",
  expanded: "is-player-expanded",
  modalOpen: "is-player-modal-open",
  navDim: "is-player-nav-dim",
};
