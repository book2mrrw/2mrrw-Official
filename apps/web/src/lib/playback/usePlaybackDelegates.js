"use client";

import { useCallback, useMemo } from "react";

/**
 * Returns all thin service delegates for AudioProvider.
 * Every callback has [] deps — all reads happen inside the service at call-time
 * via self._deps, never through React closure capture.
 * The returned object is stable (useMemo([], [])) — identity never changes.
 */
export function usePlaybackDelegates(helperServiceRef, commandServiceRef) {
  // ─── Helper Service Delegates ────────────────────────────────────────────────

  // Audibility / Transport Health
  const getAudibilityParams               = useCallback(() => helperServiceRef.current.getAudibilityParams(), []);
  const readIsAudiblyPlaying              = useCallback(() => helperServiceRef.current.readIsAudiblyPlaying(), []);
  const getPlaybackTransportHealth        = useCallback(() => helperServiceRef.current.getPlaybackTransportHealth(), []);

  // Lifecycle Recovery Suppression
  const armLifecycleRecoverySuppression   = useCallback((source, reason) => helperServiceRef.current.armLifecycleRecoverySuppression(source, reason), []);
  const isLifecycleRecoverySuppressed     = useCallback((reason) => helperServiceRef.current.isLifecycleRecoverySuppressed(reason), []);

  // Lifecycle Truth State
  const computeLifecycleAudioTruthState   = useCallback(() => helperServiceRef.current.computeLifecycleAudioTruthState(), []);
  const isLifecycleOsSuspended            = useCallback(() => helperServiceRef.current.isLifecycleOsSuspended(), []);
  const blockRecoveryForLifecycleOsSuspended = useCallback((source, reason) => helperServiceRef.current.blockRecoveryForLifecycleOsSuspended(source, reason), []);
  const evaluateLifecyclePlaybackHealth   = useCallback((opts) => helperServiceRef.current.evaluateLifecyclePlaybackHealth(opts), []);

  // Diagnostic Helpers
  const tracePlayback                     = useCallback((type, source, extra) => helperServiceRef.current.tracePlayback(type, source, extra), []);
  const emitBackgroundPlaybackDiagnostics = useCallback((source) => helperServiceRef.current.emitBackgroundPlaybackDiagnostics(source), []);
  const emitPhase21AudibleSnapshot        = useCallback((source) => helperServiceRef.current.emitPhase21AudibleSnapshot(source), []);
  const logDirectInternalCallViolation    = useCallback((fnName) => helperServiceRef.current.logDirectInternalCallViolation(fnName), []);
  const getCurrentTrackId                 = useCallback(() => helperServiceRef.current.getCurrentTrackId(), []);
  const clearViewportResume               = useCallback(() => helperServiceRef.current.clearViewportResume(), []);

  // Progress / Continuity
  const getProgressSnapshot              = useCallback(() => helperServiceRef.current.getProgressSnapshot(), []);
  const getContinuitySnapshot            = useCallback(() => helperServiceRef.current.getContinuitySnapshot(), []);
  const setContinuityFrozenUi            = useCallback((next) => helperServiceRef.current.setContinuityFrozenUi(next), []);
  const subscribeProgress                = useCallback((listener) => helperServiceRef.current.subscribeProgress(listener), []);
  const notifyProgressListeners          = useCallback((opts) => helperServiceRef.current.notifyProgressListeners(opts), []);
  const clearContinuityFreeze            = useCallback((source) => helperServiceRef.current.clearContinuityFreeze(source), []);
  const getTransportSnapshot             = useCallback(() => helperServiceRef.current.getTransportSnapshot(), []);
  const subscribeTransport               = useCallback((listener) => helperServiceRef.current.subscribeTransport(listener), []);
  const notifyTransportListeners         = useCallback(() => helperServiceRef.current.notifyTransportListeners(), []);
  const subscribeIdentity                = useCallback((listener) => helperServiceRef.current.subscribeIdentity(listener), []);
  const getIdentitySnapshot              = useCallback(() => helperServiceRef.current.getIdentitySnapshot(), []);
  const notifyIdentityListeners          = useCallback(() => helperServiceRef.current.notifyIdentityListeners(), []);
  const syncProgressTime                 = useCallback((time) => helperServiceRef.current.syncProgressTime(time), []);

  // Timers / Session
  const stopPositionSaveTimer            = useCallback(() => helperServiceRef.current.stopPositionSaveTimer(), []);
  const stopStallRecovery                = useCallback(() => helperServiceRef.current.stopStallRecovery(), []);
  const startStallRecovery               = useCallback(() => helperServiceRef.current.startStallRecovery(), []);
  const startPositionSaveTimer           = useCallback(() => helperServiceRef.current.startPositionSaveTimer(), []);
  const finalizeStreamSession            = useCallback((meta, opts) => helperServiceRef.current.finalizeStreamSession(meta, opts), []);
  const recordLocalListening             = useCallback((track, meta) => helperServiceRef.current.recordLocalListening(track, meta), []);

  // State Patching
  const logPlaybackDesyncIfNeeded        = useCallback((prev, next) => helperServiceRef.current.logPlaybackDesyncIfNeeded(prev, next), []);
  const reconcileIsPlayingWithElement    = useCallback((prev, next) => helperServiceRef.current.reconcileIsPlayingWithElement(prev, next), []);
  const patchTransport                   = useCallback((patch) => helperServiceRef.current.patchTransport(patch), []);
  const patchState                       = useCallback((patch) => helperServiceRef.current.patchState(patch), []);
  const patchUI                          = useCallback((patch) => helperServiceRef.current.patchUI(patch), []);

  // RAF / Progress
  const stopProgressRaf                  = useCallback(() => helperServiceRef.current.stopProgressRaf(), []);
  const startProgressRaf                 = useCallback(() => helperServiceRef.current.startProgressRaf(), []);

  // Keep-Alive Ping
  const postKeepAliveToServiceWorker     = useCallback(() => helperServiceRef.current.postKeepAliveToServiceWorker(), []);
  const stopKeepAlivePing                = useCallback(() => helperServiceRef.current.stopKeepAlivePing(), []);
  const startKeepAlivePing               = useCallback(() => helperServiceRef.current.startKeepAlivePing(), []);

  // Media Session
  const syncPositionState                = useCallback((force) => helperServiceRef.current.syncPositionState(force), []);
  const updateMediaSession               = useCallback((track, opts) => helperServiceRef.current.updateMediaSession(track, opts), []);
  const rehydrateMediaSession            = useCallback(() => helperServiceRef.current.rehydrateMediaSession(), []);
  const syncMediaSessionAfterLifecycle   = useCallback((resumeAfter) => helperServiceRef.current.syncMediaSessionAfterLifecycle(resumeAfter), []);

  // Web Audio Init
  const connectWebAudioDownstream        = useCallback(() => helperServiceRef.current.connectWebAudioDownstream(), []);
  const initWebAudio                     = useCallback(() => helperServiceRef.current.initWebAudio(), []);
  const attemptLightweightPlaybackResume = useCallback((source, effectContext) => helperServiceRef.current.attemptLightweightPlaybackResume(source, effectContext), []);

  // CS Mode / Stream
  const applyCsToElement                 = useCallback((audio, presentation, resumeAt) => helperServiceRef.current.applyCsToElement(audio, presentation, resumeAt), []);
  const resolveLibraryStreamForTrack     = useCallback((track, opts) => helperServiceRef.current.resolveLibraryStreamForTrack(track, opts), []);
  const scheduleNextTrackPreload         = useCallback(() => helperServiceRef.current.scheduleNextTrackPreload(), []);
  const hintUpcomingPlay                 = useCallback((track) => helperServiceRef.current.hintUpcomingPlay(track), []);
  const setUserVolume                    = useCallback((level) => helperServiceRef.current.setUserVolume(level), []);

  // ─── Command Service Delegates ───────────────────────────────────────────────

  const playTrackInternal          = useCallback((track, opts) => commandServiceRef.current.playTrackInternal(track, opts), []);
  const upgradeToFullStream        = useCallback(() => commandServiceRef.current.upgradeToFullStream(), []);
  const setOnPreviewEnded          = useCallback((handler) => commandServiceRef.current.setOnPreviewEnded(handler), []);
  const overrideConcurrentStream   = useCallback(() => commandServiceRef.current.overrideConcurrentStream(), []);
  const dismissStreamConflict      = useCallback(() => commandServiceRef.current.dismissStreamConflict(), []);
  const retryStreamPlayback        = useCallback(() => commandServiceRef.current.retryStreamPlayback(), []);
  const recoverAudioHard           = useCallback((reason, opts) => commandServiceRef.current.recoverAudioHard(reason, opts), []);
  const releaseLifecycleRecoveryLock    = useCallback((lockId) => commandServiceRef.current.releaseLifecycleRecoveryLock(lockId), []);
  const clearBfcacheRecoveryInProgress  = useCallback(() => commandServiceRef.current.clearBfcacheRecoveryInProgress(), []);
  const beginBfcacheRecoveryInProgress  = useCallback(() => commandServiceRef.current.beginBfcacheRecoveryInProgress(), []);
  const requestPlaybackRecovery    = useCallback((event, payload) => commandServiceRef.current.requestPlaybackRecovery(event, payload), []);
  const runCoalescedLifecycleRecovery = useCallback(({ reason, resumeAfter, trigger }) => commandServiceRef.current.runCoalescedLifecycleRecovery({ reason, resumeAfter, trigger }), []);
  const resumePlaybackTransport    = useCallback(() => commandServiceRef.current.resumePlaybackTransport(), []);
  const applyCSModeToTrack         = useCallback((track) => commandServiceRef.current.applyCSModeToTrack(track), []);
  const toggleCSMode               = useCallback(() => commandServiceRef.current.toggleCSMode(), []);
  const setQueueInternal           = useCallback((tracks, startIndex) => commandServiceRef.current.setQueueInternal(tracks, startIndex), []);
  const playNextInternal           = useCallback((opts) => commandServiceRef.current.playNextInternal(opts), []);
  const playPreviousInternal       = useCallback(() => commandServiceRef.current.playPreviousInternal(), []);
  const advanceShuffleOrder        = useCallback((queue, currentIndex) => commandServiceRef.current.advanceShuffleOrder(queue, currentIndex), []);
  const playQueueInternal          = useCallback((tracks, startIndex, options) => commandServiceRef.current.playQueueInternal(tracks, startIndex, options), []);
  const pauseInternal              = useCallback((opts) => commandServiceRef.current.pauseInternal(opts), []);
  const pauseForViewport           = useCallback(() => commandServiceRef.current.pauseForViewport(), []);
  const resumeInternal             = useCallback((effectContext) => commandServiceRef.current.resumeInternal(effectContext), []);
  const seekInternal               = useCallback((time) => commandServiceRef.current.seekInternal(time), []);
  const seekBack                   = useCallback((seconds = 15) => commandServiceRef.current.seekBack(seconds), []);
  const seekForward                = useCallback((seconds = 15) => commandServiceRef.current.seekForward(seconds), []);
  const setPlaybackRateInternal    = useCallback((rate) => commandServiceRef.current.setPlaybackRateInternal(rate), []);
  const resumeTrackAtPosition      = useCallback((trackId, position) => commandServiceRef.current.resumeTrackAtPosition(trackId, position), []);
  const resumeFromViewport         = useCallback(() => commandServiceRef.current.resumeFromViewport(), []);
  const stopInternal               = useCallback(() => commandServiceRef.current.stopInternal(), []);

  // ─── Stable Return ───────────────────────────────────────────────────────────
  // useMemo with [] deps → same object reference on every render.
  // Safe because every function inside has [] deps (stable identity).
  return useMemo(() => ({
    // Helper delegates
    getAudibilityParams, readIsAudiblyPlaying, getPlaybackTransportHealth,
    armLifecycleRecoverySuppression, isLifecycleRecoverySuppressed,
    computeLifecycleAudioTruthState, isLifecycleOsSuspended,
    blockRecoveryForLifecycleOsSuspended, evaluateLifecyclePlaybackHealth,
    tracePlayback, emitBackgroundPlaybackDiagnostics, emitPhase21AudibleSnapshot,
    logDirectInternalCallViolation, getCurrentTrackId, clearViewportResume,
    getProgressSnapshot, getContinuitySnapshot, setContinuityFrozenUi,
    subscribeProgress, notifyProgressListeners, clearContinuityFreeze,
    getTransportSnapshot, subscribeTransport, notifyTransportListeners,
    subscribeIdentity, getIdentitySnapshot, notifyIdentityListeners, syncProgressTime,
    stopPositionSaveTimer, stopStallRecovery, startStallRecovery, startPositionSaveTimer,
    finalizeStreamSession, recordLocalListening,
    logPlaybackDesyncIfNeeded, reconcileIsPlayingWithElement, patchTransport, patchState, patchUI,
    stopProgressRaf, startProgressRaf,
    postKeepAliveToServiceWorker, stopKeepAlivePing, startKeepAlivePing,
    syncPositionState, updateMediaSession, rehydrateMediaSession, syncMediaSessionAfterLifecycle,
    connectWebAudioDownstream, initWebAudio, attemptLightweightPlaybackResume,
    applyCsToElement, resolveLibraryStreamForTrack, scheduleNextTrackPreload,
    hintUpcomingPlay, setUserVolume,
    // Command delegates
    playTrackInternal, upgradeToFullStream, setOnPreviewEnded,
    overrideConcurrentStream, dismissStreamConflict, retryStreamPlayback, recoverAudioHard,
    releaseLifecycleRecoveryLock, clearBfcacheRecoveryInProgress, beginBfcacheRecoveryInProgress,
    requestPlaybackRecovery, runCoalescedLifecycleRecovery, resumePlaybackTransport,
    applyCSModeToTrack, toggleCSMode, setQueueInternal, playNextInternal, playPreviousInternal,
    advanceShuffleOrder, playQueueInternal, pauseInternal, pauseForViewport,
    resumeInternal, seekInternal, seekBack, seekForward, setPlaybackRateInternal,
    resumeTrackAtPosition, resumeFromViewport, stopInternal,
  }), []); // eslint-disable-line react-hooks/exhaustive-deps
}
