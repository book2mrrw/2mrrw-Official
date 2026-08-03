/**
 * Phase 14F — audibility truth (element + Web Audio + time advancement).
 *
 * Truth hierarchy (highest → lowest):
 *   audibility (isAudioActuallyAudible) > element (!paused) > machine (orchestration) > React isPlaying
 *
 * Audibility = truth; not merely !audio.paused or React isPlaying.
 */

export const AUDIBILITY_FROZEN_MS = 2000;
export const AUDIBILITY_ADVANCE_MIN_SEC = 0.08;
/** Grace before requiring currentTime advancement after play starts. */
export const AUDIBILITY_WARMUP_MS = 1200;
/** Short poll window before RECOVER_COMPLETE when resumeAfter is set (Phase 15D). */
export const AUDIBILITY_RECOVERY_WAIT_MS = 450;
export const AUDIBILITY_RECOVERY_POLL_MS = 50;
/** Delay between audibility retry attempts in hard recovery (initial + 2 retries). */
export const AUDIBILITY_RECOVERY_RETRY_DELAY_MS = 350;
export const AUDIBILITY_RECOVERY_MAX_ATTEMPTS = 3;

/**
 * @param {{ lastTime: number, lastAt: number, frozenSince: number | null }} sample
 */
export function createAudibilitySample() {
  return { lastTime: 0, lastAt: 0, frozenSince: null };
}

/**
 * Record currentTime samples (call from RAF / timeupdate while ostensibly playing).
 * @param {HTMLMediaElement | null | undefined} audio
 * @param {{ current: ReturnType<typeof createAudibilitySample> }} sampleRef
 */
export function updateAudibilitySample(audio, sampleRef) {
  if (!audio || audio.paused || audio.ended) return;
  const now = Date.now();
  const t = audio.currentTime || 0;
  const sample = sampleRef.current;
  if (sample.lastAt === 0) {
    sampleRef.current = { lastTime: t, lastAt: now, frozenSince: now };
    return;
  }
  if (t > sample.lastTime + AUDIBILITY_ADVANCE_MIN_SEC) {
    sampleRef.current = { lastTime: t, lastAt: now, frozenSince: null };
    return;
  }
  if (sample.frozenSince == null) {
    sampleRef.current = { ...sample, frozenSince: now };
  }
}

export function resetAudibilitySample(sampleRef) {
  sampleRef.current = createAudibilitySample();
}

/**
 * @param {{
 *   audio: HTMLMediaElement | null | undefined;
 *   webAudioContext?: AudioContext | null;
 *   sampleRef: { current: ReturnType<typeof createAudibilitySample> };
 * }} params
 */
export const PLAYBACK_TRUTH_VIOLATION = "DOUBLE_TRUTH_DETECTED";

/**
 * Detects React/element audibility drift (UI or !paused vs actual sound).
 * @param {{
 *   audio: HTMLMediaElement | null | undefined;
 *   webAudioContext?: AudioContext | null;
 *   sampleRef: { current: ReturnType<typeof createAudibilitySample> };
 *   uiPlaying?: boolean;
 * }} params
 */
export function validatePlaybackTruthIntegrity({
  audio,
  webAudioContext = null,
  sampleRef,
  uiPlaying = false,
}) {
  if (!audio) return { ok: true, violation: null, reason: null };

  const audible = isAudioActuallyAudible({ audio, webAudioContext, sampleRef });
  const elementActive = !audio.paused && !audio.ended;

  if (uiPlaying && !audible) {
    return {
      ok: false,
      violation: PLAYBACK_TRUTH_VIOLATION,
      reason: "ui_playing_not_audible",
    };
  }
  if (elementActive && !audible) {
    return {
      ok: false,
      violation: PLAYBACK_TRUTH_VIOLATION,
      reason: "element_active_not_audible",
    };
  }

  return { ok: true, violation: null, reason: null };
}

export function isAudioActuallyAudible({ audio, webAudioContext = null, sampleRef }) {
  if (!audio || audio.paused || audio.ended) return false;
  if (audio.readyState < 2) return false;
  if (webAudioContext && webAudioContext.state !== "running") return false;

  const now = Date.now();
  const sample = sampleRef.current;
  if (sample.lastAt === 0) {
    updateAudibilitySample(audio, sampleRef);
    return false;
  }

  const t = audio.currentTime || 0;
  const advanced = t > sample.lastTime + AUDIBILITY_ADVANCE_MIN_SEC;
  if (advanced) return true;

  const frozenSince = sample.frozenSince ?? sample.lastAt;
  if (now - frozenSince > AUDIBILITY_FROZEN_MS) return false;

  if (now - sample.lastAt < AUDIBILITY_WARMUP_MS && audio.readyState >= 2) {
    return webAudioContext == null || webAudioContext.state === "running";
  }

  return false;
}

/**
 * Poll until audible or timeout (Phase 15D recovery gate).
 * @param {Parameters<typeof isAudioActuallyAudible>[0]} params
 * @param {number} [maxWaitMs]
 */
export async function waitForPlaybackAudibility(
  params,
  maxWaitMs = AUDIBILITY_RECOVERY_WAIT_MS
) {
  const { audio, sampleRef } = params;
  if (!audio) return false;
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    updateAudibilitySample(audio, sampleRef);
    if (isAudioActuallyAudible(params)) return true;
    await new Promise((resolve) => {
      setTimeout(resolve, AUDIBILITY_RECOVERY_POLL_MS);
    });
  }
  updateAudibilitySample(audio, sampleRef);
  return isAudioActuallyAudible(params);
}

/**
 * Tear down Web Audio graph nodes; caller stops RAF / element pause separately.
 */
export function teardownWebAudioGraph({
  audioCtxRef,
  sourceRef,
  analyserRef,
  stereoPannerRef,
  bassFilterRef,
  webAudioInitializedRef,
  webAudioAvailableRef,
  /** When true, disconnect downstream nodes but keep AudioContext + MediaElementSource for reuse. */
  preserveMediaElementSource = false,
}) {
  const disconnectSafe = (node) => {
    try {
      node?.disconnect?.();
    } catch {
      /* partial graph */
    }
  };
  disconnectSafe(analyserRef?.current);
  disconnectSafe(stereoPannerRef?.current);
  disconnectSafe(bassFilterRef?.current);
  if (!preserveMediaElementSource) {
    disconnectSafe(sourceRef?.current);
  }

  if (preserveMediaElementSource) {
    if (analyserRef) analyserRef.current = null;
    if (stereoPannerRef) stereoPannerRef.current = null;
    if (bassFilterRef) bassFilterRef.current = null;
    if (webAudioInitializedRef) webAudioInitializedRef.current = false;
    return;
  }

  const ctx = audioCtxRef?.current;
  if (ctx) {
    try {
      if (ctx.state !== "closed") {
        void ctx.close();
      }
    } catch {
      /* already closed */
    }
  }

  if (audioCtxRef) audioCtxRef.current = null;
  if (sourceRef) sourceRef.current = null;
  if (analyserRef) analyserRef.current = null;
  if (stereoPannerRef) stereoPannerRef.current = null;
  if (bassFilterRef) bassFilterRef.current = null;
  if (webAudioInitializedRef) webAudioInitializedRef.current = false;
  if (webAudioAvailableRef) webAudioAvailableRef.current = true;
}
