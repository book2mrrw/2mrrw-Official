/**
 * Fake media layer for physical certification.
 *
 * WHAT IS REAL IN THIS HARNESS:
 *   - dispatchPlaybackCommand (real)      - serial command queue (real)
 *   - emergency bypass lane (real)        - PLAY_QUEUE supersede counter (real)
 *   - watchdog + circuit breaker (real)   - activeCommandRef guard (real)
 *   - executePlaybackCommand (real)       - command payload mapping (real)
 *   - PlaybackCore / AuthorityGate / PlaybackCoreAdapter (real)
 *   - wireProductionCore (real)
 *
 * WHAT IS FAKED:
 *   - Only the leaf handler bag: playTrack / pause / resume / seek / setQueue.
 *     These stand in for PSM + WebAudioEngine + HLS + <audio>.
 *
 * The fake models the REAL handler contract exactly, including the property that
 * makes this whole exercise necessary:
 *
 *     seek(time)   ← takes a time ONLY. No media identity.
 *
 * so a SEEK applies to whatever track the element currently holds. That is the
 * production signature (usePlaybackDelegates.js: seekInternal(time)), not a
 * simplification introduced here.
 */

import { getAudioEngineRuntime } from "@/lib/playback/audio-engine-runtime";

export const Transport = Object.freeze({
  IDLE:    "IDLE",
  PLAYING: "PLAYING",
  PAUSED:  "PAUSED",
});

/**
 * Physical media state — the ground truth this suite asserts against.
 * `mediaIdentity` is what is actually loaded in the element, NOT what the user
 * last intended.
 */
export class FakeMediaRuntime {
  constructor() {
    this.mediaIdentity = null;
    this.position = 0;
    this.transport = Transport.IDLE;
    this.queue = [];
    this.queueIndex = -1;
    this.log = [];
    /** ms of simulated manifest/stream resolution latency for playTrack */
    this.loadLatencyMs = 0;
    /** set true to make playTrack hang until releaseStall() (stalled-stream scenario) */
    this.stallLoad = false;
    this._releaseStall = null;
  }

  /** Release a stalled playTrack so the harness does not sit on the 35s watchdog. */
  releaseStall() {
    this.stallLoad = false;
    this._releaseStall?.();
    this._releaseStall = null;
  }

  reset() {
    // Bump the generation so any in-flight load from a previous test becomes a
    // no-op instead of mutating this test's state.
    this.generation = (this.generation ?? 0) + 1;
    this.releaseStall();
    this.mediaIdentity = null;
    this.position = 0;
    this.transport = Transport.IDLE;
    this.queue = [];
    this.queueIndex = -1;
    this.log = [];
    this.loadLatencyMs = 0;
    this.stallLoad = false;
  }

  /** Force the element into a known prior state (a track already playing). */
  primeLoaded(trackId, position = 0, transport = Transport.PLAYING) {
    this.mediaIdentity = trackId;
    this.position = position;
    this.transport = transport;
  }

  snapshot() {
    return {
      mediaIdentity: this.mediaIdentity,
      position: this.position,
      transport: this.transport,
    };
  }

  /**
   * PhysicalStateProbe over this runtime. In production the probe reads
   * stateGetterRef + the <audio> element; here it reads the fake directly. Same
   * contract either way: read-only observation of actual physical state.
   */
  probe() {
    const rt = this;
    return { snapshot: () => rt.snapshot() };
  }

  /** Handler bag matching the production commandHandlersRef contract. */
  handlers() {
    const rt = this;
    return {
      async playTrack(track, _opts = {}) {
        const id = track?.id ?? track?.slug ?? null;
        const gen = rt.generation ?? 0;
        rt.log.push({ h: "playTrack", id, at: Date.now() });
        if (rt.stallLoad) {
          // Simulates a manifest fetch that hangs until explicitly released.
          await new Promise((resolve) => { rt._releaseStall = resolve; });
          return true; // released as an abandoned load — never sets transport
        }
        if (rt.loadLatencyMs > 0) {
          await new Promise((r) => setTimeout(r, rt.loadLatencyMs));
        }
        // Test isolation: a load that outlived its test must not mutate state.
        if ((rt.generation ?? 0) !== gen) return false;
        rt.mediaIdentity = id;
        rt.position = 0;
        rt.transport = Transport.PLAYING;
        return true;
      },
      async playQueue(tracks, startIndex = 0, _opts = {}) {
        rt.log.push({ h: "playQueue", n: tracks.length, startIndex, at: Date.now() });
        rt.queue = tracks;
        rt.queueIndex = startIndex;
        const t = tracks[startIndex];
        rt.mediaIdentity = t?.id ?? t?.slug ?? null;
        rt.position = 0;
        rt.transport = Transport.PLAYING;
        return true;
      },
      setQueue(tracks, startIndex = 0) {
        rt.log.push({ h: "setQueue", n: tracks.length, startIndex, at: Date.now() });
        rt.queue = tracks;
        rt.queueIndex = startIndex;
      },
      pause(_opts = {}) {
        rt.log.push({ h: "pause", at: Date.now() });
        rt.transport = Transport.PAUSED;
      },
      async resume() {
        rt.log.push({ h: "resume", at: Date.now() });
        if (rt.mediaIdentity) rt.transport = Transport.PLAYING;
        return true;
      },
      // PRODUCTION SIGNATURE: time only, no identity.
      seek(time) {
        rt.log.push({ h: "seek", time, appliedTo: rt.mediaIdentity, at: Date.now() });
        rt.position = time;
      },
      async playNext() { rt.log.push({ h: "playNext", at: Date.now() }); return true; },
      async playPrev() { rt.log.push({ h: "playPrev", at: Date.now() }); return true; },
      stop() {
        rt.log.push({ h: "stop", at: Date.now() });
        rt.transport = Transport.IDLE;
        rt.mediaIdentity = null;
        rt.position = 0;
      },
      async recover() { return true; },
      async upgradeStream() { return true; },
      async retryStream() { return true; },
      async resumeViewport() { return true; },
      setPlaybackRate() {},
    };
  }
}

/**
 * Install the fake media layer into the REAL audio engine runtime refs and
 * return control handles. Everything above the handler bag stays production.
 */
export function installFakeMediaLayer() {
  const runtime = new FakeMediaRuntime();
  const refs = getAudioEngineRuntime().refs;

  const gesture = { initWebAudioCalls: 0, syncDuringDispatch: false };

  refs.commandHandlersRef.current = runtime.handlers();
  refs.initWebAudioRef.current = () => { gesture.initWebAudioCalls += 1; };
  refs.stateGetterRef.current = () => ({
    currentTrack: runtime.mediaIdentity ? { id: runtime.mediaIdentity } : null,
    isPlaying: runtime.transport === Transport.PLAYING,
    source: "physical-harness",
  });
  refs.tracePlaybackRef.current = () => {};

  return { runtime, refs, gesture };
}

/**
 * Wait until the whole system is quiet: no dispatch in flight, no convergence
 * pass running, and the physical snapshot stable.
 *
 * Physical stability ALONE is not sufficient — during a slow media load nothing
 * changes for hundreds of milliseconds while the reconciler still has work
 * pending. Engine idleness is the authoritative signal; stability is the tiebreak
 * for the legacy-only cases where no engine exists.
 *
 * @param {object|null} core  a wired PlaybackCore, or null for legacy-only cases
 * @param {FakeMediaRuntime} runtime
 * @param {{ timeoutMs?: number, quietMs?: number }} [opts]
 */
export async function settleSystem(core, runtime, { timeoutMs = 3000, quietMs = 60 } = {}) {
  const engine = core?._executionEngine ?? null;
  const deadline = Date.now() + timeoutMs;
  let last = JSON.stringify(runtime.snapshot());
  let quietSince = null;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 10));
    const now = JSON.stringify(runtime.snapshot());
    const engineBusy = engine ? (engine.inFlight > 0 || engine.isConverging) : false;
    const changed = now !== last;
    last = now;

    if (engineBusy || changed) { quietSince = null; continue; }
    if (quietSince === null) quietSince = Date.now();
    if (Date.now() - quietSince >= quietMs) break;
  }
  await new Promise((r) => setImmediate(r));
}

/** Reset the real queue/circuit refs between tests so cases stay independent. */
export function resetRuntimeRefs() {
  const refs = getAudioEngineRuntime().refs;
  refs.commandQueueRef.current = Promise.resolve();
  refs.activeCommandRef.current = null;
  refs.queueCircuitOpenRef.current = false;
  refs.commandExecutionDepthRef.current = 0;
  if (refs.queueWatchdogRef.current) {
    clearTimeout(refs.queueWatchdogRef.current);
    refs.queueWatchdogRef.current = null;
  }
  refs.queueRef.current = [];
  refs.queueIndexRef.current = -1;
}
