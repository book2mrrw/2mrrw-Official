/**
 * Canonical playback command constants, aliases, and gesture classifications.
 * Extracted here so any module can import them without depending on AudioContext.
 */

export const PLAYBACK_COMMANDS = Object.freeze({
  PLAY_TRACK: "PLAY_TRACK",
  PLAY_QUEUE: "PLAY_QUEUE",
  PAUSE: "PAUSE",
  RESUME: "RESUME",
  SEEK: "SEEK",
  NEXT_TRACK: "NEXT_TRACK",
  PREV_TRACK: "PREV_TRACK",
  INTERRUPT: "INTERRUPT",
  RECOVER: "RECOVER",
  STOP: "STOP",
  COMPLETE: "COMPLETE",
  SET_QUEUE: "SET_QUEUE",
  REPLACE_TRACK: "REPLACE_TRACK",
  UPGRADE_STREAM: "UPGRADE_STREAM",
  RECOVER_PLAYBACK: "RECOVER_PLAYBACK",
  VIEWPORT_PAUSE: "VIEWPORT_PAUSE",
  VIEWPORT_RESUME: "VIEWPORT_RESUME",
  SET_PLAYBACK_RATE: "SET_PLAYBACK_RATE",
});

/** Lowercase / legacy string aliases resolved by dispatchPlaybackCommand. */
export const PLAYBACK_COMMAND_ALIASES = Object.freeze({
  play: PLAYBACK_COMMANDS.PLAY_TRACK,
  pause: PLAYBACK_COMMANDS.PAUSE,
  resume: PLAYBACK_COMMANDS.RESUME,
  stop: PLAYBACK_COMMANDS.STOP,
  seek: PLAYBACK_COMMANDS.SEEK,
  setQueue: PLAYBACK_COMMANDS.SET_QUEUE,
  playQueue: PLAYBACK_COMMANDS.PLAY_QUEUE,
  playTrack: PLAYBACK_COMMANDS.PLAY_TRACK,
  replaceTrack: PLAYBACK_COMMANDS.REPLACE_TRACK,
  upgradeStream: PLAYBACK_COMMANDS.UPGRADE_STREAM,
  recoverPlayback: PLAYBACK_COMMANDS.RECOVER_PLAYBACK,
  viewportPause: PLAYBACK_COMMANDS.VIEWPORT_PAUSE,
  viewportResume: PLAYBACK_COMMANDS.VIEWPORT_RESUME,
  setPlaybackRate: PLAYBACK_COMMANDS.SET_PLAYBACK_RATE,
});

/**
 * Commands that must resume Web Audio synchronously inside the activating gesture
 * (before any queue microtask). iOS rejects resume() issued after an await.
 */
export const USER_GESTURE_PLAYBACK_COMMANDS = Object.freeze(new Set([
  PLAYBACK_COMMANDS.PLAY_TRACK,
  PLAYBACK_COMMANDS.RESUME,
  PLAYBACK_COMMANDS.PLAY_QUEUE,
  PLAYBACK_COMMANDS.NEXT_TRACK,
  PLAYBACK_COMMANDS.PREV_TRACK,
  PLAYBACK_COMMANDS.REPLACE_TRACK,
]));

/** Standard command timeout — non-streaming operations. */
export const PLAYBACK_COMMAND_TIMEOUT_MS = 15000;
/** Stream resolve / signed swap can exceed 15s without being stalled. */
export const PLAYBACK_STREAM_COMMAND_TIMEOUT_MS = 35000;
/** A command older than this is considered abandoned and the slot is recycled. */
export const ACTIVE_COMMAND_STALE_MS = 20000;

/** Commands that initiate or swap the stream — use the longer stream timeout. */
export const STREAM_COMMANDS = Object.freeze(new Set([
  PLAYBACK_COMMANDS.PLAY_TRACK,
  PLAYBACK_COMMANDS.PLAY_QUEUE,
  PLAYBACK_COMMANDS.UPGRADE_STREAM,
  PLAYBACK_COMMANDS.REPLACE_TRACK,
]));

/** Commands that bypass the serial queue and execute with emergency priority. */
export const EMERGENCY_BYPASS_COMMANDS = Object.freeze(new Set([
  PLAYBACK_COMMANDS.STOP,
  PLAYBACK_COMMANDS.PAUSE,
]));

/** Commands that abort any in-progress stream load when they arrive. */
export const STREAM_ABORT_COMMANDS = Object.freeze(new Set([
  PLAYBACK_COMMANDS.PLAY_TRACK,
  PLAYBACK_COMMANDS.PLAY_QUEUE,
  PLAYBACK_COMMANDS.NEXT_TRACK,
  PLAYBACK_COMMANDS.PREV_TRACK,
  PLAYBACK_COMMANDS.REPLACE_TRACK,
]));
