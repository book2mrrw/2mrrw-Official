/**
 * wireProductionCore — the single, deterministic wiring point between
 * PlaybackCore and the real production command dispatcher.
 *
 * ARCHITECTURE POSITION (Slice 1B):
 *
 *   UI / caller
 *     → getProductionPlaybackCore().port.play({ ... })      [synchronous]
 *       → CommandGateway.dispatch()                          [synchronous]
 *         → IntentFactory.create()                           [synchronous]
 *         → AuthorityGate.register()                         [synchronous]
 *         → PlaybackCoreAdapter.execute(intent)              [synchronous]
 *           → dispatchPlaybackCommand(type, payload)         [REAL production fn]
 *             → initWebAudio + resumeSync + silent unlock    [SYNCHRONOUS — iOS gesture]
 *             → emergency bypass lane (PAUSE / STOP)
 *             → serial command queue
 *               → executePlaybackCommand
 *                 → handler bag → PSM → WebAudioEngine → HLS → <audio>
 *
 * WHY THIS FILE EXISTS — AND WHY IT IS NOT AudioPhase10Bridge:
 *   AudioPhase10Bridge is loaded through Next.js `dynamic()`. Wiring Core there
 *   would make adapter injection race the first user gesture: a tap that lands
 *   before the chunk resolves would hit a CONSTRUCTING Core. This module is a
 *   plain ES module with no React dependency, so `dispatchPlaybackCommand` — a
 *   permanently stable module singleton — is available at import time and
 *   injection completes synchronously during module evaluation of the first
 *   caller. There is no window in which the Core exists but is not READY.
 *
 * iOS GESTURE PRESERVATION (critical — do not introduce awaits above this line):
 *   dispatchPlaybackCommand performs initWebAudioRef.current(), resumeSync(),
 *   and the silent-element unlock SYNCHRONOUSLY at call time, before its first
 *   await. Every hop in the Core chain above is likewise synchronous. If any
 *   future change introduces an await, a microtask hop, or a dynamic import
 *   between the gesture handler and dispatchPlaybackCommand, iOS Safari will
 *   drop the activation token and playback will silently fail to start.
 *   This property is asserted by the physical certification suite.
 *
 * PRODUCTION SCOPE (Slice 1B — locked):
 *   Live routing is restricted to PLAY / PAUSE / RESUME / SEEK via
 *   CoreLiveCommandScope. NEXT / PREVIOUS / SET_QUEUE / REORDER_QUEUE remain
 *   dormant contract infrastructure until the Selection Domain migration,
 *   because NowPlaying + Queue + QueueIndex must transfer together.
 *
 * OWNERSHIP (unchanged):
 *   PlaybackCore owns USER INTENT AUTHORITY.
 *   PSM remains the canonical physical / orchestration transport authority.
 *   This module does not transfer any domain to Core ownership.
 */

import { dispatchPlaybackCommand } from "@/lib/playback/command-dispatcher";
import { getAudioEngineRuntime }   from "@/lib/playback/audio-engine-runtime";
import { PlaybackCore }            from "../core/PlaybackCore.js";
import { PlaybackCoreAdapter }     from "../adapters/PlaybackCoreAdapter.js";
import { ConvergenceEngine }       from "../convergence/ConvergenceEngine.js";
import { createRuntimePhysicalProbe } from "../convergence/PhysicalStateProbe.js";
import { CoreLiveCommandScope }    from "../types/index.js";

/** @type {PlaybackCore | null} */
let _core = null;

/**
 * Build a Core instance already wired to the real production dispatcher.
 * Extracted so tests can construct an identically-wired Core against a
 * substituted dispatch function without touching the module singleton.
 *
 * @param {object} [opts]
 * @param {(type: string, payload: object) => Promise<any>} [opts.dispatch]
 * @param {{ snapshot: () => object }} [opts.probe]  physical-state probe (tests substitute this)
 * @param {Set<string>} [opts.liveScope]
 * @param {boolean} [opts.loggerEnabled]
 * @returns {PlaybackCore}
 */
export function buildWiredCore({
  dispatch = dispatchPlaybackCommand,
  probe = createRuntimePhysicalProbe(getAudioEngineRuntime),
  liveScope = CoreLiveCommandScope,
  loggerEnabled = true,
} = {}) {
  const core = PlaybackCore.create({ loggerEnabled });

  // The adapter knows how to speak to the legacy pipeline. It needs the same
  // AuthorityGate the gateway registered against.
  const adapter = new PlaybackCoreAdapter({
    dispatch,
    authorityGate: core._authorityGate,
    logger: core.logger,
    liveScope,
  });

  // Slice 1C: the execution engine is the reconciler, not a 1:1 command mapper.
  // Phase 1 of ConvergenceEngine.execute() still dispatches synchronously, so the
  // iOS gesture token, the emergency PAUSE lane, and serial ordering are preserved.
  const engine = new ConvergenceEngine({
    desiredStore: core._desiredStore,
    adapter,
    probe,
    logger: core.logger,
    liveScope,
  });

  // Synchronous injection — Core is READY before this function returns.
  core._injectExecutionEngine(engine);
  return core;
}

/**
 * Get the production PlaybackCore singleton, creating and wiring it on first
 * call. Always returns a READY Core — never CONSTRUCTING.
 *
 * @returns {PlaybackCore}
 */
export function getProductionPlaybackCore() {
  if (!_core) _core = buildWiredCore();
  return _core;
}

/**
 * Tear down and clear the singleton. Intended for HMR and tests only.
 * Production code must never call this — destroying the Core rotates the
 * sessionEpoch (Invariant 17).
 */
export function resetProductionPlaybackCore() {
  _core?.destroy();
  _core = null;
}
