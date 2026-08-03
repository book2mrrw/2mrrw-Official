/**
 * Phase 9 — maps UI/system events to recommended dispatchPlaybackCommand actions.
 * Does not mutate playback; callers dispatch from user handlers or AudioContext listeners.
 */

/** @typedef {'user_action' | 'scroll_action' | 'entitlement_event' | 'route_event'} PlaybackIntentEvent */

/**
 * @typedef {Object} PlaybackIntentResolution
 * @property {string} command — dispatchPlaybackCommand type or alias
 * @property {Record<string, unknown>} payload
 * @property {string} reason — human-readable routing rationale
 * @property {PlaybackIntentEvent} event
 * @property {string} intent
 */

const INTENT_ROUTES = {
  user_action: {
    play_track: {
      command: "playTrack",
      buildPayload: (ctx) => ({ track: ctx.track, options: ctx.options || {} }),
      reason: "explicit_user_play_single",
    },
    play_queue: {
      command: "playQueue",
      buildPayload: (ctx) => ({
        tracks: ctx.tracks || [],
        startIndex: ctx.startIndex ?? 0,
        options: ctx.options || {},
      }),
      reason: "explicit_user_play_queue",
    },
    pause: {
      command: "pause",
      buildPayload: () => ({}),
      reason: "explicit_user_pause",
    },
    resume: {
      command: "resume",
      buildPayload: () => ({}),
      reason: "explicit_user_resume",
    },
    toggle: {
      command: "pause",
      buildPayload: () => ({}),
      reason: "toggle_same_track_pause",
      when: (ctx) => ctx.sameTrack && ctx.isPlaying,
    },
    toggle_resume: {
      command: "resume",
      buildPayload: () => ({}),
      reason: "toggle_same_track_resume",
      when: (ctx) => ctx.sameTrack && !ctx.isPlaying,
    },
    seek: {
      command: "seek",
      buildPayload: (ctx) => ({ time: ctx.time ?? 0 }),
      reason: "explicit_user_seek",
    },
    stop: {
      command: "stop",
      buildPayload: () => ({}),
      reason: "explicit_user_stop",
    },
    set_queue: {
      command: "setQueue",
      buildPayload: (ctx) => ({
        tracks: ctx.tracks || [],
        startIndex: ctx.startIndex ?? 0,
      }),
      reason: "explicit_user_set_queue",
    },
  },
  scroll_action: {
    viewport_pause: {
      command: "viewportPause",
      buildPayload: () => ({}),
      reason: "audio_visual_viewport_enter",
    },
    viewport_resume: {
      command: "viewportResume",
      buildPayload: () => ({}),
      reason: "audio_visual_viewport_exit",
    },
  },
  entitlement_event: {
    upgrade_stream: {
      command: "upgradeStream",
      buildPayload: () => ({}),
      reason: "entitlements_updated_preview_to_full",
    },
    recover: {
      command: "recoverPlayback",
      buildPayload: () => ({}),
      reason: "entitlement_refresh_resume_playback",
    },
  },
  route_event: {
    stop_on_navigate: {
      command: "stop",
      buildPayload: () => ({}),
      reason: "route_change_clear_playback",
    },
    set_queue_restore: {
      command: "setQueue",
      buildPayload: (ctx) => ({
        tracks: ctx.tracks || [],
        startIndex: ctx.startIndex ?? 0,
      }),
      reason: "session_recovery_restore_queue",
    },
  },
};

/**
 * Resolve a playback intent to a dispatchPlaybackCommand recommendation.
 * AuthContext refresh must not call this for mutations — use read-only account state only.
 *
 * @param {PlaybackIntentEvent} event
 * @param {string} intent
 * @param {Record<string, unknown>} [context]
 * @returns {PlaybackIntentResolution | null}
 */
export function resolvePlaybackIntent(event, intent, context = {}) {
  const routes = INTENT_ROUTES[event];
  if (!routes) return null;

  if (event === "user_action" && intent === "toggle") {
    if (context.sameTrack && context.isPlaying) {
      return buildResolution(event, "toggle", routes.toggle, context);
    }
    if (context.sameTrack && !context.isPlaying) {
      return buildResolution(event, "toggle_resume", routes.toggle_resume, context);
    }
    return buildResolution(event, "play_track", routes.play_track, context);
  }

  const route = routes[intent];
  if (!route) return null;
  if (typeof route.when === "function" && !route.when(context)) return null;
  return buildResolution(event, intent, route, context);
}

/**
 * @param {PlaybackIntentEvent} event
 * @param {string} intent
 * @param {{ command: string; buildPayload: (ctx: Record<string, unknown>) => Record<string, unknown>; reason: string }} route
 * @param {Record<string, unknown>} context
 */
function buildResolution(event, intent, route, context) {
  return {
    event,
    intent,
    command: route.command,
    payload: route.buildPayload(context),
    reason: route.reason,
  };
}

export const PLAYBACK_INTENT_EVENTS = {
  USER_ACTION: "user_action",
  SCROLL_ACTION: "scroll_action",
  ENTITLEMENT_EVENT: "entitlement_event",
  ROUTE_EVENT: "route_event",
};
