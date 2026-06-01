/**
 * Dev-only Performance API helpers. No-op in production.
 */

/** @type {Record<string, string>} */
export const MARKS = {
  MODAL_OPEN_START: "2mrrw:modal-open-start",
  MODAL_OPEN_END: "2mrrw:modal-open-end",
  IMMERSIVE_RENDER_START: "2mrrw:immersive-render-start",
  IMMERSIVE_RENDER_END: "2mrrw:immersive-render-end",
  ARTWORK_DECODE_START: "2mrrw:artwork-decode-start",
  ARTWORK_DECODE_END: "2mrrw:artwork-decode-end",
  AUDIO_START_LATENCY_START: "2mrrw:audio-start-latency-start",
  AUDIO_START_LATENCY_END: "2mrrw:audio-start-latency-end",
  TRANSITION_START: "2mrrw:transition-start",
  TRANSITION_END: "2mrrw:transition-end",
  ROUTE_NAV_START: "2mrrw:route-nav-start",
  ROUTE_NAV_END: "2mrrw:route-nav-end",
  QUEUE_UPDATE_START: "2mrrw:queue-update-start",
  QUEUE_UPDATE_END: "2mrrw:queue-update-end",
  HYDRATION_START: "2mrrw:hydration-start",
  HYDRATION_END: "2mrrw:hydration-end",
  GESTURE_START: "2mrrw:gesture-start",
  GESTURE_RESPONSE: "2mrrw:gesture-response",
  /** Playback latency pipeline (dev audit) */
  PLAYBACK_TAP: "2mrrw:playback-tap",
  PLAYBACK_QUEUE_RESOLVED: "2mrrw:playback-queue-resolved",
  PLAYBACK_REQUEST: "2mrrw:playback-request",
  PLAYBACK_RESOLVER_START: "2mrrw:playback-resolver-start",
  PLAYBACK_RESOLVER_END: "2mrrw:playback-resolver-end",
  PLAYBACK_SIGNED_URL: "2mrrw:playback-signed-url",
  PLAYBACK_SRC_ASSIGN: "2mrrw:playback-src-assign",
  PLAYBACK_LOADEDMETADATA: "2mrrw:playback-loadedmetadata",
  PLAYBACK_LOADEDDATA: "2mrrw:playback-loadeddata",
  PLAYBACK_FIRST_BYTE: "2mrrw:playback-first-byte",
  PLAYBACK_CANPLAY: "2mrrw:playback-canplay",
  PLAYBACK_CANPLAYTHROUGH: "2mrrw:playback-canplaythrough",
  PLAYBACK_AUDIO_PLAY_CALL: "2mrrw:playback-audio-play-call",
  PLAYBACK_PLAY_PROMISE_RESOLVED: "2mrrw:playback-play-promise-resolved",
  PLAYBACK_AUDIBLE: "2mrrw:playback-audible",
  PLAYBACK_PROVIDER_MOUNT: "2mrrw:playback-provider-mount",
  PLAYBACK_AUDIO_ELEMENT_READY: "2mrrw:playback-audio-element-ready",
  /** waitAudioSrcReady internal (Phase 5.2.8 decode isolation) */
  PLAYBACK_WAIT_SRC_START: "2mrrw:playback-wait-src-start",
  PLAYBACK_WAIT_SRC_END: "2mrrw:playback-wait-src-end",
  PLAYBACK_WAIT_SRC_GUARD_SAME_SRC: "2mrrw:playback-wait-src-guard-same-src",
  PLAYBACK_WAIT_SRC_GUARD_EARLY_READY: "2mrrw:playback-wait-src-guard-early-ready",
  PLAYBACK_WAIT_SRC_LOAD_CALL: "2mrrw:playback-wait-src-load-call",
};

/** Scenario labels for decode-path isolation (dev dump only). */
export const PLAYBACK_SCENARIOS = {
  COLD_START: "cold-start",
  WARM_START: "warm-start",
  CACHED_PLAYBACK: "cached-playback",
  TRACK_SKIP: "track-skip",
  ALBUM_TRACKLIST: "album-tracklist",
  QUEUE_AUTO_ADVANCE: "queue-auto-advance",
};

const PLAYBACK_MARK_PREFIX = "2mrrw:playback-";

/** Ordered pipeline stages for waterfall reporting. */
const PLAYBACK_WATERFALL_STAGES = [
  { key: "tap", label: "Tap (playTrack/playQueue)", mark: MARKS.PLAYBACK_TAP },
  { key: "queue-resolved", label: "Queue resolution", mark: MARKS.PLAYBACK_QUEUE_RESOLVED },
  { key: "playTrack-internal", label: "playTrackInternal start", mark: MARKS.PLAYBACK_REQUEST },
  { key: "resolver-start", label: "Resolver start (fetchLibraryStream)", mark: MARKS.PLAYBACK_RESOLVER_START },
  { key: "resolver-end", label: "Resolver completion (JSON url)", mark: MARKS.PLAYBACK_RESOLVER_END },
  { key: "signed-url", label: "Signed URL HEAD validated", mark: MARKS.PLAYBACK_SIGNED_URL },
  { key: "src-assign", label: "audio.src assignment", mark: MARKS.PLAYBACK_SRC_ASSIGN },
  { key: "loadedmetadata", label: "loadedmetadata", mark: MARKS.PLAYBACK_LOADEDMETADATA },
  { key: "loadeddata", label: "loadeddata", mark: MARKS.PLAYBACK_LOADEDDATA },
  { key: "canplay", label: "canplay", mark: MARKS.PLAYBACK_CANPLAY },
  { key: "canplaythrough", label: "canplaythrough", mark: MARKS.PLAYBACK_CANPLAYTHROUGH },
  { key: "audio-play-call", label: "audio.play() call", mark: MARKS.PLAYBACK_AUDIO_PLAY_CALL },
  { key: "play-promise-resolved", label: "play() promise resolved", mark: MARKS.PLAYBACK_PLAY_PROMISE_RESOLVED },
  { key: "audible", label: "First audible frame (playing)", mark: MARKS.PLAYBACK_AUDIBLE },
];

const PLAYBACK_STAGE_MEASURES = [
  ["playback-tap-to-queue", MARKS.PLAYBACK_TAP, MARKS.PLAYBACK_QUEUE_RESOLVED],
  ["playback-queue-to-request", MARKS.PLAYBACK_QUEUE_RESOLVED, MARKS.PLAYBACK_REQUEST],
  ["playback-tap-to-request", MARKS.PLAYBACK_TAP, MARKS.PLAYBACK_REQUEST],
  ["playback-request-to-resolver", MARKS.PLAYBACK_REQUEST, MARKS.PLAYBACK_RESOLVER_START],
  ["playback-resolver", MARKS.PLAYBACK_RESOLVER_START, MARKS.PLAYBACK_RESOLVER_END],
  ["playback-signed-url", MARKS.PLAYBACK_RESOLVER_END, MARKS.PLAYBACK_SIGNED_URL],
  ["playback-signed-url-to-src", MARKS.PLAYBACK_SIGNED_URL, MARKS.PLAYBACK_SRC_ASSIGN],
  ["playback-src-to-loadedmetadata", MARKS.PLAYBACK_SRC_ASSIGN, MARKS.PLAYBACK_LOADEDMETADATA],
  ["playback-loadedmetadata-to-loadeddata", MARKS.PLAYBACK_LOADEDMETADATA, MARKS.PLAYBACK_LOADEDDATA],
  ["playback-loadeddata-to-canplay", MARKS.PLAYBACK_LOADEDDATA, MARKS.PLAYBACK_CANPLAY],
  ["playback-canplay-to-play-call", MARKS.PLAYBACK_CANPLAY, MARKS.PLAYBACK_AUDIO_PLAY_CALL],
  ["playback-canplay-to-canplaythrough", MARKS.PLAYBACK_CANPLAY, MARKS.PLAYBACK_CANPLAYTHROUGH],
  ["playback-canplaythrough-to-play-call", MARKS.PLAYBACK_CANPLAYTHROUGH, MARKS.PLAYBACK_AUDIO_PLAY_CALL],
  ["playback-play-call-to-promise", MARKS.PLAYBACK_AUDIO_PLAY_CALL, MARKS.PLAYBACK_PLAY_PROMISE_RESOLVED],
  ["playback-promise-to-audible", MARKS.PLAYBACK_PLAY_PROMISE_RESOLVED, MARKS.PLAYBACK_AUDIBLE],
  ["playback-src-to-first-byte", MARKS.PLAYBACK_SRC_ASSIGN, MARKS.PLAYBACK_FIRST_BYTE],
  ["playback-first-byte-to-canplay", MARKS.PLAYBACK_FIRST_BYTE, MARKS.PLAYBACK_CANPLAY],
  ["playback-canplay-to-audible", MARKS.PLAYBACK_CANPLAY, MARKS.PLAYBACK_AUDIBLE],
  ["playback-tap-to-audible", MARKS.PLAYBACK_TAP, MARKS.PLAYBACK_AUDIBLE],
  ["playback-provider-to-tap", MARKS.PLAYBACK_PROVIDER_MOUNT, MARKS.PLAYBACK_TAP],
  ["playback-hydration-to-tap", MARKS.HYDRATION_END, MARKS.PLAYBACK_TAP],
  ["audio-start-latency", MARKS.AUDIO_START_LATENCY_START, MARKS.AUDIO_START_LATENCY_END],
  ["playback-wait-src-total", MARKS.PLAYBACK_WAIT_SRC_START, MARKS.PLAYBACK_WAIT_SRC_END],
  ["playback-wait-src-to-metadata", MARKS.PLAYBACK_WAIT_SRC_START, MARKS.PLAYBACK_LOADEDMETADATA],
  ["playback-wait-src-to-loadeddata", MARKS.PLAYBACK_WAIT_SRC_START, MARKS.PLAYBACK_LOADEDDATA],
  ["playback-wait-src-to-canplay", MARKS.PLAYBACK_WAIT_SRC_START, MARKS.PLAYBACK_CANPLAY],
  ["playback-wait-src-assign-to-load", MARKS.PLAYBACK_SRC_ASSIGN, MARKS.PLAYBACK_WAIT_SRC_LOAD_CALL],
];

/** Decode/waitAudioSrcReady bucket — ordered sub-segments for Phase 5.2.8 reports. */
const DECODE_PATH_MEASURES = [
  ["src-to-loadedmetadata", "playback-src-to-loadedmetadata"],
  ["loadedmetadata-to-loadeddata", "playback-loadedmetadata-to-loadeddata"],
  ["loadeddata-to-canplay", "playback-loadeddata-to-canplay"],
  ["canplay-to-play-call", "playback-canplay-to-play-call"],
  ["play-call-to-promise", "playback-play-call-to-promise"],
  ["promise-to-audible", "playback-promise-to-audible"],
];

const WAIT_SRC_GUARD_MEASURES = [
  ["guard-same-src-fast-path", MARKS.PLAYBACK_WAIT_SRC_GUARD_SAME_SRC],
  ["guard-early-readyState", MARKS.PLAYBACK_WAIT_SRC_GUARD_EARLY_READY],
];

const READY_STATE_LABELS = ["HAVE_NOTHING", "HAVE_METADATA", "HAVE_CURRENT_DATA", "HAVE_FUTURE_DATA", "HAVE_ENOUGH_DATA"];
const NETWORK_STATE_LABELS = ["NETWORK_EMPTY", "NETWORK_IDLE", "NETWORK_LOADING", "NETWORK_NO_SOURCE"];

function canMark() {
  return (
    process.env.NODE_ENV === "development" &&
    typeof performance !== "undefined" &&
    typeof performance.mark === "function"
  );
}

/** @param {string} name */
export function perfMark(name) {
  if (!canMark()) return;
  try {
    performance.mark(name);
  } catch {
    /* ignore invalid mark names */
  }
}

/**
 * @param {string} measureName
 * @param {string} startMark
 * @param {string} [endMark]
 */
export function perfMeasure(measureName, startMark, endMark) {
  if (!canMark() || typeof performance.measure !== "function") return;
  try {
    performance.measure(measureName, startMark, endMark);
    const entries = performance.getEntriesByName(measureName, "measure");
    const last = entries[entries.length - 1];
    if (last) {
      console.debug(`[perf] ${measureName}: ${last.duration.toFixed(1)}ms`);
    }
    performance.clearMeasures(measureName);
    performance.clearMarks(startMark);
    if (endMark) performance.clearMarks(endMark);
  } catch {
    /* measure may fail if marks missing */
  }
}

/** @param {string} markName */
function getLatestMarkTime(markName) {
  const entries = performance.getEntriesByName(markName, "mark");
  const last = entries[entries.length - 1];
  return last ? last.startTime : null;
}

/** @param {string} startMark @param {string} endMark */
function measureBetweenMarks(startMark, endMark) {
  const start = getLatestMarkTime(startMark);
  const end = getLatestMarkTime(endMark);
  if (start == null || end == null) return null;
  return Math.round((end - start) * 10) / 10;
}

/** @param {PerformanceMark[]} marks */
function buildWaterfallFromMarks(marks) {
  const tapTime = marks.find((m) => m.name === MARKS.PLAYBACK_TAP)?.startTime ?? null;
  return PLAYBACK_WATERFALL_STAGES.map((stage) => {
    const entry = marks.filter((m) => m.name === stage.mark).pop();
    const timestamp = entry ? Math.round(entry.startTime * 10) / 10 : null;
    const offsetFromTap =
      entry && tapTime != null ? Math.round((entry.startTime - tapTime) * 10) / 10 : null;
    return {
      stage: stage.key,
      label: stage.label,
      mark: stage.mark,
      timestamp,
      offsetFromTapMs: offsetFromTap,
      present: Boolean(entry),
    };
  });
}

/** @param {Array<{ stage: string, offsetFromTapMs: number | null, present: boolean }>} waterfall */
function buildStageDurations(waterfall) {
  /** @type {Record<string, number | null>} */
  const durations = {};
  for (let i = 1; i < waterfall.length; i += 1) {
    const prev = waterfall[i - 1];
    const curr = waterfall[i];
    if (!prev.present || !curr.present) {
      durations[`${prev.stage}-to-${curr.stage}`] = null;
      continue;
    }
    const delta = (curr.offsetFromTapMs ?? 0) - (prev.offsetFromTapMs ?? 0);
    durations[`${prev.stage}-to-${curr.stage}`] = Math.round(delta * 10) / 10;
  }
  return durations;
}

function collectElementEvents() {
  if (typeof window === "undefined") return [];
  return window.__2mrrwPlaybackElementEvents || [];
}

/** @param {string} label @param {Record<string, unknown>} [meta] */
export function setPlaybackScenario(label, meta = {}) {
  if (!canMark() || typeof window === "undefined") return;
  window.__2mrrwPlaybackScenario = {
    label,
    meta,
    setAt: Math.round(performance.now() * 10) / 10,
  };
}

export function getPlaybackScenario() {
  if (typeof window === "undefined") return null;
  return window.__2mrrwPlaybackScenario ?? null;
}

function hasMark(name) {
  return performance.getEntriesByName(name, "mark").length > 0;
}

/** Summarize readyState/networkState dwell + buffering from element event ring. */
function analyzeReadyStateTelemetry(events, tapMarkTime) {
  /** @type {Record<string, number>} */
  const readyStateDwellMs = {};
  /** @type {Record<string, number>} */
  const networkStateDwellMs = {};
  let waitingCount = 0;
  let stalledCount = 0;
  let suspendCount = 0;
  let progressCount = 0;
  /** @type {Array<{ t: number, from: number, to: number, reason?: string }>} */
  const readyStateTransitions = [];
  /** @type {Array<{ t: number, from: number, to: number, reason?: string }>} */
  const networkStateTransitions = [];

  let lastReady = -1;
  let lastNetwork = -1;
  let lastReadyT = tapMarkTime ?? (events[0]?.t ?? 0);
  let lastNetworkT = tapMarkTime ?? (events[0]?.t ?? 0);

  for (const evt of events) {
    if (evt.type === "waiting") waitingCount += 1;
    if (evt.type === "stalled") stalledCount += 1;
    if (evt.type === "suspend") suspendCount += 1;
    if (evt.type === "progress") progressCount += 1;

    if (evt.type === "readyState-change") {
      readyStateTransitions.push({
        t: evt.t,
        from: evt.from,
        to: evt.to,
        reason: evt.reason,
        offsetFromTapMs: evt.offsetFromTapMs,
      });
      if (lastReady >= 0) {
        const label = READY_STATE_LABELS[lastReady] ?? `RS_${lastReady}`;
        const delta = Math.max(0, evt.t - lastReadyT);
        readyStateDwellMs[label] = Math.round(((readyStateDwellMs[label] ?? 0) + delta) * 10) / 10;
      }
      lastReady = evt.to;
      lastReadyT = evt.t;
    }

    if (evt.type === "networkState-change") {
      networkStateTransitions.push({
        t: evt.t,
        from: evt.from,
        to: evt.to,
        reason: evt.reason,
        offsetFromTapMs: evt.offsetFromTapMs,
      });
      if (lastNetwork >= 0) {
        const label = NETWORK_STATE_LABELS[lastNetwork] ?? `NS_${lastNetwork}`;
        const delta = Math.max(0, evt.t - lastNetworkT);
        networkStateDwellMs[label] = Math.round(((networkStateDwellMs[label] ?? 0) + delta) * 10) / 10;
      }
      lastNetwork = evt.to;
      lastNetworkT = evt.t;
    }
  }

  const endT = events.length ? events[events.length - 1].t : lastReadyT;
  if (lastReady >= 0) {
    const label = READY_STATE_LABELS[lastReady] ?? `RS_${lastReady}`;
    const delta = Math.max(0, endT - lastReadyT);
    readyStateDwellMs[label] = Math.round(((readyStateDwellMs[label] ?? 0) + delta) * 10) / 10;
  }
  if (lastNetwork >= 0) {
    const label = NETWORK_STATE_LABELS[lastNetwork] ?? `NS_${lastNetwork}`;
    const delta = Math.max(0, endT - lastNetworkT);
    networkStateDwellMs[label] = Math.round(((networkStateDwellMs[label] ?? 0) + delta) * 10) / 10;
  }

  return {
    readyStateDwellMs,
    networkStateDwellMs,
    readyStateTransitions,
    networkStateTransitions,
    buffering: { waitingCount, stalledCount, suspendCount, progressCount },
  };
}

function buildWaitAudioSrcReadyBreakdown(measures) {
  /** @type {Record<string, number | null | boolean>} */
  const guards = {};
  for (const [key, mark] of WAIT_SRC_GUARD_MEASURES) {
    guards[key] = hasMark(mark);
  }
  return {
    totalMs: measures["playback-wait-src-total"] ?? null,
    toLoadedmetadataMs: measures["playback-wait-src-to-metadata"] ?? null,
    toLoadeddataMs: measures["playback-wait-src-to-loadeddata"] ?? null,
    toCanplayMs: measures["playback-wait-src-to-canplay"] ?? null,
    srcAssignToLoadCallMs: measures["playback-wait-src-assign-to-load"] ?? null,
    guards,
  };
}

/**
 * Dev-only: match PerformanceResourceTiming for the active audio fetch.
 * Cross-origin entries require Timing-Allow-Origin on the CDN response.
 * @param {HTMLAudioElement} audio
 * @returns {Record<string, unknown> | null}
 */
export function collectPlaybackResourceTiming(audio) {
  if (!canMark() || !audio?.currentSrc) return null;
  const target = audio.currentSrc;
  const resources = performance.getEntriesByType("resource");
  const matches = resources.filter(
    (e) => e.name === target || e.name.split("?")[0] === target.split("?")[0]
  );
  const entry = /** @type {PerformanceResourceTiming | undefined} */ (
    matches[matches.length - 1]
  );
  if (!entry) {
    return { matched: false, currentSrc: target };
  }

  const ms = (v) => (v > 0 ? Math.round(v * 10) / 10 : null);
  const seg = (start, end) => {
    if (start <= 0 || end <= 0 || end < start) return null;
    return ms(end - start);
  };

  const breakdown = {
    matched: true,
    name: entry.name,
    initiatorType: entry.initiatorType,
    transferSize: entry.transferSize,
    encodedBodySize: entry.encodedBodySize,
    decodedBodySize: entry.decodedBodySize,
    dnsMs: seg(entry.domainLookupStart, entry.domainLookupEnd),
    tcpMs: seg(entry.connectStart, entry.connectEnd),
    tlsMs:
      entry.secureConnectionStart > 0
        ? seg(entry.secureConnectionStart, entry.connectEnd)
        : null,
    preconnectSavingsNote:
      entry.connectStart > 0 && entry.domainLookupEnd <= entry.connectStart
        ? "dns-overlap-with-connect"
        : null,
    requestDispatchMs: seg(entry.connectEnd || entry.fetchStart, entry.requestStart),
    ttfbMs: seg(entry.requestStart, entry.responseStart),
    downloadMs: seg(entry.responseStart, entry.responseEnd),
    totalResourceMs: seg(entry.fetchStart, entry.responseEnd),
    fetchStart: ms(entry.fetchStart),
    responseStart: ms(entry.responseStart),
    responseEnd: ms(entry.responseEnd),
  };

  if (typeof window !== "undefined") {
    window.__2mrrwLastPlaybackResourceTiming = breakdown;
  }
  return breakdown;
}

function buildDecodePathBreakdown(measures) {
  /** @type {Record<string, number | null>} */
  const segments = {};
  let sum = 0;
  let parts = 0;
  for (const [key, measureName] of DECODE_PATH_MEASURES) {
    const val = measures[measureName] ?? null;
    segments[key] = val;
    if (val != null) {
      sum += val;
      parts += 1;
    }
  }
  return {
    segments,
    summedMs: parts ? Math.round(sum * 10) / 10 : null,
  };
}

/**
 * Dev-only: compute playback stage durations from Performance marks.
 * Returns full waterfall with timestamps, stage durations, and element events.
 */
export function dumpPlaybackTiming() {
  if (!canMark()) return {};
  /** @type {Record<string, number | null>} */
  const measures = {};
  for (const [name, start, end] of PLAYBACK_STAGE_MEASURES) {
    try {
      performance.measure(name, start, end);
      const entries = performance.getEntriesByName(name, "measure");
      const last = entries[entries.length - 1];
      measures[name] = last ? Math.round(last.duration * 10) / 10 : null;
      performance.clearMeasures(name);
    } catch {
      measures[name] = null;
    }
  }

  const playbackMarks = performance
    .getEntriesByType("mark")
    .filter((e) => e.name.startsWith(PLAYBACK_MARK_PREFIX) || e.name.startsWith("2mrrw:audio-start-latency"));

  const waterfall = buildWaterfallFromMarks(/** @type {PerformanceMark[]} */ (playbackMarks));
  const stageDurations = buildStageDurations(waterfall);
  const tapToAudible = measures["playback-tap-to-audible"] ?? measureBetweenMarks(MARKS.PLAYBACK_TAP, MARKS.PLAYBACK_AUDIBLE);
  const tapMarkTime = getLatestMarkTime(MARKS.PLAYBACK_TAP);
  const elementEvents = collectElementEvents().map((evt) => ({
    ...evt,
    offsetFromTapMs:
      tapMarkTime != null ? Math.round((evt.t - tapMarkTime) * 10) / 10 : null,
  }));
  const readyStateAnalysis = analyzeReadyStateTelemetry(elementEvents, tapMarkTime);
  const waitAudioSrcReadyBreakdown = buildWaitAudioSrcReadyBreakdown(measures);
  const decodePathBreakdown = buildDecodePathBreakdown(measures);
  const sourceAcquisition =
    typeof window !== "undefined" ? window.__2mrrwLastPlaybackResourceTiming ?? null : null;
  const srcToMetadataMs = measures["playback-src-to-loadedmetadata"] ?? null;
  const resourceTtfbMs = sourceAcquisition?.ttfbMs ?? null;
  const parseDispatchGapMs =
    srcToMetadataMs != null && resourceTtfbMs != null
      ? Math.round(Math.max(0, srcToMetadataMs - resourceTtfbMs) * 10) / 10
      : null;
  const scenario = getPlaybackScenario();

  const formattedWaterfall = waterfall
    .filter((s) => s.present)
    .map((s) => {
      const delta =
        s.offsetFromTapMs != null ? `${s.offsetFromTapMs.toFixed(1)} ms`.padStart(10) : "       n/a";
      return `${delta}  ${s.label}`;
    })
    .join("\n");

  const result = {
    capturedAt: new Date().toISOString(),
    platform: typeof navigator !== "undefined" ? navigator.userAgent : "unknown",
    scenario: scenario?.label ?? null,
    scenarioMeta: scenario?.meta ?? null,
    totalTapToAudibleMs: tapToAudible,
    measures,
    waterfall,
    stageDurations,
    decodePathBreakdown,
    sourceAcquisition,
    sourceAcquisitionAttribution: {
      srcToLoadedmetadataMs: srcToMetadataMs,
      resourceTimingTtfbMs: resourceTtfbMs,
      estimatedParseAndDispatchMs: parseDispatchGapMs,
      note:
        parseDispatchGapMs != null
          ? "Gap ≈ demux/header parse + event loop after responseStart (not in Resource Timing)."
          : "Run dev play then dumpPlaybackTiming(); requires Timing-Allow-Origin for cross-origin CDN.",
    },
    waitAudioSrcReadyBreakdown,
    readyStateAnalysis,
    formattedWaterfall,
    elementEvents,
    audioContextState:
      typeof window !== "undefined" ? window.__2mrrwLastAudioContextState ?? null : null,
    mediaSessionPlaybackState:
      typeof navigator !== "undefined" && "mediaSession" in navigator
        ? navigator.mediaSession.playbackState
        : null,
  };

  console.group(`[perf] playback timing — scenario: ${scenario?.label ?? "unknown"}`);
  console.table(measures);
  console.log("decode path (ms):", decodePathBreakdown.segments);
  console.log("source acquisition (Resource Timing):", sourceAcquisition);
  if (sourceAcquisition) {
    console.log("src→metadata attribution:", {
      srcToLoadedmetadataMs: srcToMetadataMs,
      resourceTimingTtfbMs: resourceTtfbMs,
      estimatedParseAndDispatchMs: parseDispatchGapMs,
    });
  }
  console.log("waitAudioSrcReady:", waitAudioSrcReadyBreakdown);
  console.log("readyState/networkState:", readyStateAnalysis);
  console.group("[perf] playback waterfall (offset from tap, ms)");
  console.table(
    waterfall.map((s) => ({
      stage: s.stage,
      offsetMs: s.offsetFromTapMs,
      present: s.present,
    }))
  );
  if (formattedWaterfall) {
    console.log(formattedWaterfall);
  }
  if (elementEvents.length) {
    console.table(elementEvents);
  }
  console.groupEnd();

  if (typeof window !== "undefined") {
    window.__2mrrwLastPlaybackTiming = result;
    window.dumpPlaybackTiming = dumpPlaybackTiming;
  }
  return result;
}

/** Dev-only ring buffer for `<audio>` element telemetry. */
function recordPlaybackElementEvent(type, audio, extra = {}) {
  if (!canMark() || typeof window === "undefined") return;
  if (!window.__2mrrwPlaybackElementEvents) {
    window.__2mrrwPlaybackElementEvents = [];
  }
  const entry = {
    t: Math.round(performance.now() * 10) / 10,
    type,
    readyState: audio?.readyState,
    readyStateLabel: READY_STATE_LABELS[audio?.readyState] ?? String(audio?.readyState),
    networkState: audio?.networkState,
    networkStateLabel: NETWORK_STATE_LABELS[audio?.networkState] ?? String(audio?.networkState),
    paused: audio?.paused,
    ...extra,
  };
  window.__2mrrwPlaybackElementEvents.push(entry);
  if (window.__2mrrwPlaybackElementEvents.length > 80) {
    window.__2mrrwPlaybackElementEvents.shift();
  }
  console.debug("[perf:audio-element]", type, entry);
}

let lastReadyState = -1;
let lastNetworkState = -1;

/**
 * Attach dev-only `<audio>` event listeners for readyState/networkState transitions
 * and buffering events. Behavior-neutral — logging/marks only.
 * @param {HTMLAudioElement} audio
 * @returns {() => void} cleanup
 */
export function attachPlaybackElementDevTelemetry(audio) {
  if (!canMark() || !audio) return () => {};

  const pollStateTransitions = (reason) => {
    if (audio.readyState !== lastReadyState) {
      recordPlaybackElementEvent("readyState-change", audio, {
        from: lastReadyState,
        to: audio.readyState,
        reason,
      });
      lastReadyState = audio.readyState;
    }
    if (audio.networkState !== lastNetworkState) {
      recordPlaybackElementEvent("networkState-change", audio, {
        from: lastNetworkState,
        to: audio.networkState,
        reason,
      });
      lastNetworkState = audio.networkState;
    }
  };

  const handlers = {
    loadedmetadata: () => {
      perfMark(MARKS.PLAYBACK_LOADEDMETADATA);
      collectPlaybackResourceTiming(audio);
      pollStateTransitions("loadedmetadata");
    },
    loadeddata: () => {
      perfMark(MARKS.PLAYBACK_LOADEDDATA);
      pollStateTransitions("loadeddata");
    },
    canplay: () => {
      perfMark(MARKS.PLAYBACK_CANPLAY);
      pollStateTransitions("canplay");
    },
    canplaythrough: () => {
      perfMark(MARKS.PLAYBACK_CANPLAYTHROUGH);
      pollStateTransitions("canplaythrough");
    },
    waiting: () => recordPlaybackElementEvent("waiting", audio),
    stalled: () => recordPlaybackElementEvent("stalled", audio),
    suspend: () => recordPlaybackElementEvent("suspend", audio),
    progress: () => recordPlaybackElementEvent("progress", audio),
    playing: () => pollStateTransitions("playing"),
  };

  lastReadyState = audio.readyState;
  lastNetworkState = audio.networkState;

  for (const [event, handler] of Object.entries(handlers)) {
    audio.addEventListener(event, handler);
  }

  return () => {
    for (const [event, handler] of Object.entries(handlers)) {
      audio.removeEventListener(event, handler);
    }
  };
}

/** Record Web Audio / unlock context state for platform comparison (dev only). */
export function recordAudioContextState(ctx, label = "snapshot") {
  if (!canMark() || typeof window === "undefined") return;
  window.__2mrrwLastAudioContextState = {
    label,
    state: ctx?.state ?? "none",
    sampleRate: ctx?.sampleRate ?? null,
    t: Math.round(performance.now() * 10) / 10,
  };
}

/** Clear all marks/measures with a given prefix (dev cleanup). */
export function perfClear(prefix) {
  if (!canMark()) return;
  for (const entry of performance.getEntriesByType("mark")) {
    if (entry.name.startsWith(prefix)) performance.clearMarks(entry.name);
  }
  for (const entry of performance.getEntriesByType("measure")) {
    if (entry.name.startsWith(prefix)) performance.clearMeasures(entry.name);
  }
}

/** Reset playback marks + element event ring before a new tap (dev only). */
export function resetPlaybackTimingCapture() {
  if (!canMark() || typeof window === "undefined") return;
  perfClear(PLAYBACK_MARK_PREFIX);
  perfClear("2mrrw:audio-start-latency");
  window.__2mrrwPlaybackElementEvents = [];
  window.__2mrrwLastPlaybackTiming = null;
  window.__2mrrwPlaybackScenario = null;
  window.__2mrrwReadyStateDwell = null;
}

if (typeof window !== "undefined" && process.env.NODE_ENV === "development") {
  window.dumpPlaybackTiming = dumpPlaybackTiming;
}
