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
 * OWNERSHIP (Slice 2):
 *   PlaybackCore owns USER INTENT AUTHORITY and canonical TRANSPORT.
 *   PSM retains SELECTION and exposes only Core-derived compatibility fields.
 */

import { dispatchPlaybackCommand } from "@/lib/playback/command-dispatcher";
import { getAudioEngineRuntime }   from "@/lib/playback/audio-engine-runtime";
import { PlaybackCore }            from "../core/PlaybackCore.js";
import { PlaybackCoreAdapter }     from "../adapters/PlaybackCoreAdapter.js";
import { ConvergenceEngine }       from "../convergence/ConvergenceEngine.js";
import { createRuntimePhysicalProbe } from "../convergence/PhysicalStateProbe.js";
import { CoreLiveCommandScope, Domain } from "../types/index.js";
import { installCurrentPhysicalEffectGuard } from "@/lib/audio/physical-effect-authority";
import { installTransportObservationSink } from "@/lib/playback/transport-observation-port";

/** @type {PlaybackCore | null} */
let _core = null;
let _disposeTransportSink = null;

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
    effectAuthority: core._effectAuthority,
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
    effectAuthority: core._effectAuthority,
    liveScope,
  });

  // Synchronous injection — Core is READY before this function returns.
  const disposeInstalledEffectGuard = installCurrentPhysicalEffectGuard(
    core._effectAuthority,
  );
  try {
    core._injectExecutionEngine(engine, {
      effectAuthority: core._effectAuthority,
      disposeInstalledEffectGuard,
    });
    // Slice 2 final ownership transfer. All legacy producers use the injected
    // observation seam; Core is the sole canonical Transport writer from here.
    core._transferDomainToCore(Domain.TRANSPORT);
    const transport = core._transportAuthority;
    _disposeTransportSink?.();
    _disposeTransportSink = installTransportObservationSink({
      captureContext: (meta) => transport.captureContext(meta),
      observe: (type, payload, context) => transport.observe(type, payload, context),
      observeTimeline: (payload, context, options) => transport.observeTimeline(payload, context, options),
      observeMode: (payload, context) => transport.observeMode(payload, context),
      getStatusSnapshot: () => transport.statusSnapshot,
      getTimelineSnapshot: () => transport.timelineSnapshot,
      getModeSnapshot: () => transport.modeSnapshot,
      subscribeStatus: (fn) => transport.subscribeStatus(fn),
      subscribeTimeline: (fn) => transport.subscribeTimeline(fn),
      subscribeMode: (fn) => transport.subscribeMode(fn),
      getMetrics: () => transport.metrics,
    });
  } catch (error) {
    disposeInstalledEffectGuard();
    core.destroy();
    throw error;
  }
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
  _disposeTransportSink?.();
  _disposeTransportSink = null;
  _core?.destroy();
  _core = null;
}
