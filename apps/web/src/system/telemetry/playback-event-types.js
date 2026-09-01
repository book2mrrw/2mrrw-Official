/**
 * Canonical playback event type constants.
 *
 * All playback analytics events — whether routed to PostHog via telemetry.log()
 * or to the Control System via sendControlSystemPlaybackEvent() — should use
 * these constants so the event schema is consistent across both pipelines and
 * queryable for AI recommendations.
 *
 * Naming convention: domain.noun.verb (present or past tense based on when
 * the event fires — past tense for completed actions, present for in-progress).
 */

export const PLAYBACK_EVENT_TYPES = Object.freeze({
  // ── Stream lifecycle ────────────────────────────────────────────────────────
  PLAY:         "playback.play",
  PAUSE:        "playback.pause",
  RESUME:       "playback.resume",
  STOP:         "playback.stop",
  COMPLETE:     "playback.complete",
  REPLAY:       "playback.replay",
  SKIP:         "playback.skip",

  // ── Seek ───────────────────────────────────────────────────────────────────
  SEEK:         "playback.seek",
  SEEK_BACK:    "playback.seek.back",
  SEEK_FORWARD: "playback.seek.forward",

  // ── Progress ───────────────────────────────────────────────────────────────
  PROGRESS:     "playback.progress",   // periodic heartbeat (30s throttle)
  POSITION_SAVE: "playback.position.saved",

  // ── Track switching ────────────────────────────────────────────────────────
  NEXT:         "playback.next",
  PREV:         "playback.prev",
  TRACK_CHANGE: "playback.track.changed",

  // ── Queue ─────────────────────────────────────────────────────────────────
  QUEUE_ADD:    "playback.queue.add",
  QUEUE_REMOVE: "playback.queue.remove",
  QUEUE_REORDER:"playback.queue.reorder",
  QUEUE_SET:    "playback.queue.set",

  // ── Stream quality ─────────────────────────────────────────────────────────
  UPGRADE:      "playback.stream.upgraded",   // preview → full stream
  STALL:        "playback.stream.stalled",
  RECOVERY:     "playback.stream.recovered",
  ERROR:        "playback.stream.error",

  // ── Session ────────────────────────────────────────────────────────────────
  SESSION_START: "playback.session.start",
  SESSION_RESTORE: "playback.session.restored",
  SESSION_END:   "playback.session.end",

  // ── Entitlement ────────────────────────────────────────────────────────────
  PREVIEW_START: "playback.preview.start",
  PREVIEW_END:   "playback.preview.end",
  GATE_HIT:      "playback.gate.hit",         // user hit a paywall/preview gate
});

/** Map PLAYBACK_EVENT_TYPES values to telemetry log levels. */
export function eventTypeLogLevel(eventType) {
  if (!eventType) return "info";
  if (eventType.endsWith(".error") || eventType.endsWith(".stalled")) return "warn";
  return "info";
}

/**
 * Map a Control System legacy event string to the canonical PLAYBACK_EVENT_TYPES value.
 * Allows the two pipelines to normalize to the same schema.
 *
 * @param {string} csEventType  e.g. "play", "progress", "complete"
 * @returns {string} Canonical event type string.
 */
export function mapControlSystemEventType(csEventType) {
  const normalized = String(csEventType || "").toLowerCase();
  const MAP = {
    play:      PLAYBACK_EVENT_TYPES.PLAY,
    pause:     PLAYBACK_EVENT_TYPES.PAUSE,
    progress:  PLAYBACK_EVENT_TYPES.PROGRESS,
    complete:  PLAYBACK_EVENT_TYPES.COMPLETE,
    replay:    PLAYBACK_EVENT_TYPES.REPLAY,
    seek:      PLAYBACK_EVENT_TYPES.SEEK,
    skip:      PLAYBACK_EVENT_TYPES.SKIP,
    queue_add: PLAYBACK_EVENT_TYPES.QUEUE_ADD,
    save:      PLAYBACK_EVENT_TYPES.POSITION_SAVE,
  };
  return MAP[normalized] || PLAYBACK_EVENT_TYPES.PROGRESS;
}
