import { captureRecoveryOperation } from './recovery-operation';
import { waitAudioSrcReady } from '../audio/audio-element-utils';
import { PhysicalEffectAuthorityMode } from '../audio/physical-effect-authority';
import { recoveryCoordinator } from './recovery-coordinator';
import { isLibraryStreamSrc } from './stream-client';

/** One handoff owner for every post-startup HLS failure, including decode errors. */
export function createHlsFallback({ refs, requestId, signal, src, patchState, resume }) {
  let pending = null;
  return (snapshot = {}) => {
    if (pending) return pending;
    if (signal?.aborted || refs.playRequestIdRef.current !== requestId) return Promise.resolve(false);
    const operation = captureRecoveryOperation(refs, { respectPause: false });
    const audio = operation.audio;
    const position = Number.isFinite(snapshot.position) ? snapshot.position : audio.currentTime;
    const current = () => !signal?.aborted && operation.isCurrent();
    const prior = refs.recoveryVerificationRef?.current?.promise;
    const lease = { isCurrent: current, promise: null };
    pending = (async () => {
      await Promise.resolve(prior).catch(() => false);
      if (!current()) return false;
      if (refs.recoveryVerificationRef) refs.recoveryVerificationRef.current = lease;
      recoveryCoordinator.notifyStreamUpgrade();
      refs.hlsEngineRef.current = null;
      refs.skipPauseInterruptionRef.current = true;
      patchState({ isBuffering: true, playbackNetworkState: 'loading_stream' });
      try {
        let target = src;
        if (isLibraryStreamSrc(operation.track.src) && refs.resolveLibraryStreamForTrack) {
          const resolved = await refs.resolveLibraryStreamForTrack(operation.track, { force: true, signal });
          if (!current()) return false;
          target = resolved.track.src;
        }
        await waitAudioSrcReady(audio, target, { signal, timeoutMs: 12000 });
        if (!current()) return false;
        if (position > 0) audio.currentTime = Number.isFinite(audio.duration) && audio.duration > 0
          ? Math.min(position, Math.max(0, audio.duration - 0.05)) : position;
        if (refs.userPausedRef.current || refs.userIntentPausedRef.current) {
          patchState({ isPlaying: false, isBuffering: false, playbackState: 'paused', playbackNetworkState: 'idle' });
          return true;
        }
        if (refs.recoveryVerificationRef?.current === lease) refs.recoveryVerificationRef.current = null;
        const ok = await resume('hls_progressive_fallback', { effectAuthorityMode: PhysicalEffectAuthorityMode.CORE_CURRENT });
        if (!current()) return false;
        if (!ok) throw new Error('Progressive fallback did not advance');
        return true;
      } catch (error) {
        const denied = error?.code === 'ACCESS_DENIED';
        if (current()) patchState({ isPlaying: false, isBuffering: false, playbackState: 'paused',
          playbackNetworkState: 'error_stream', streamRetryable: !denied, accessDenied: denied,
          error: denied ? 'Access unavailable' : 'Playback could not continue — tap play to retry.' });
        return false;
      } finally {
        if (refs.recoveryVerificationRef?.current === lease) refs.recoveryVerificationRef.current = null;
        if (current()) refs.skipPauseInterruptionRef.current = false;
      }
    })();
    lease.promise = pending;
    return pending;
  };
}
