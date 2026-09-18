import { getWebAudioEngine } from '@/lib/audio/WebAudioEngine';
import { setActiveHLSEngine } from '@/lib/audio/HLSEngine';
import { AUDIO_ENGINE_EVENTS as EVENTS } from '@/lib/audio/AudioEngineInterface';
import { canBecomeAudible } from '@/lib/audio/audio-element-utils';
import { canPreloadAudio } from '@/lib/audio/playback-buffer';
import { getAudioEngineRuntime } from '../audio-engine-runtime';
import { nextQueueIndex } from '../queue-order';
import { PLAYBACK_SCENARIOS } from '@/lib/dev/performanceMarks';
import { recoveryCoordinator } from '../recovery-coordinator';
import { clearPlaybackPosition } from '../position-memory';
import { CrossfadeTransition, CROSSFADE_SECONDS, eligiblePair, fadeCurves, trackIdentity } from './transition';
import { prepareDeck } from './deck';
import { getCrossfadeEnabled, hasEnabledCrossfade, trackCrossfadeScope, initializeCrossfadePreference, subscribeCrossfade } from './preference';

/** Optional personal-player extension. No Broadcast dependency; no new queue,
 * AudioContext, or authority. Installed once and configured with live delegates. */
export function configureCrossfade(refs, delegates, publicApi) {
  const runtime = getAudioEngineRuntime();
  runtime.crossfadeDependencies = { refs, delegates, publicApi };
  if (runtime.crossfade) return;
  const engine = getWebAudioEngine();
  const deps = () => runtime.crossfadeDependencies;
  let tail = null;
  let tailTimer = null;
  let subscriptions = [];
  let account = null;
  let accountEpoch = 0;

  const currentEnabled = () => getCrossfadeEnabled(trackCrossfadeScope(deps().refs.stateRef.current.currentTrack));

  function snapshot() {
    const { refs: r } = deps();
    const state = r.stateRef.current;
    const audio = r.audioRef.current;
    if (account !== r.entitlementAccountStateRef.current) {
      account = r.entitlementAccountStateRef.current;
      accountEpoch++;
    }
    const queue = r.queueRef.current;
    const index = r.queueIndexRef.current;
    const nextIndex = nextQueueIndex(queue, index, r);
    const track = state.currentTrack;
    const next = queue[nextIndex];
    const remaining = audio ? audio.duration - audio.currentTime : NaN;
    return {
      track, next, queue, index, nextIndex, audio, remaining,
      key: JSON.stringify([r.playRequestIdRef.current, index, nextIndex, accountEpoch, trackCrossfadeScope(track),
        r.shuffleRef.current, r.repeatModeRef.current, queue.map((t) => [trackIdentity(t), t.src])]),
      playing: Boolean(state.isPlaying && audio && !audio.paused && !audio.ended),
      blocked: Boolean(tail || state.isBuffering || r.userPausedRef.current || r.userIntentPausedRef.current ||
        r.csModeRef.current || r.repeatModeRef.current === 'one' || r.stopAfterEachTrackRef.current ||
        r.sleepTimerRef.current.afterCurrentTrack || r.sleepTimerRef.current.endsAt ||
        engine.ctx?.state !== 'running' || !engine._standbyGain || !runtime.rebindPlaybackElement || audio?.playbackRate !== 1 ||
        audio?.webkitCurrentPlaybackTargetIsWireless || audio?.remote?.state === 'connected'),
      canPrepare: canPreloadAudio(audio, { buffering: state.isBuffering, recentStallAt: r.recentStallTimeRef.current }),
    };
  }

  function finishTail() {
    if (!tail) return;
    const ending = tail;
    tail = null;
    clearTimeout(tailTimer);
    tailTimer = null;
    ending.audio.removeEventListener('ended', finishTail);
    ending.audio.pause();
    ending.hls?.detach();
    if (engine.ctx && engine.ctx.state !== 'closed') {
      const now = engine.ctx.currentTime;
      ending.gain.gain.cancelScheduledValues(now);
      ending.gain.gain.setValueAtTime(0, now);
      // Restore only the incoming track fader, never the user's volume/effects.
      const gain = engine.mainGain.gain;
      const held = gain.value;
      gain.cancelScheduledValues(now);
      gain.setValueAtTime(held, now);
      gain.linearRampToValueAtTime(ending.incomingGain, now + 0.02);
    }
    const { delegates: d } = deps();
    if (ending.meta) d.finalizeStreamSession(ending.meta, {
      completed: ending.audio.ended, durationSeconds: ending.audio.currentTime,
    });
    d.recordLocalListening(ending.track, {
      positionSeconds: ending.audio.currentTime,
      durationSeconds: ending.audio.duration,
      completed: ending.audio.ended,
    });
    if (!hasEnabledCrossfade()) detach();
  }

  const transition = new CrossfadeTransition({
    snapshot,
    prepare: (candidate) => prepareDeck(engine, candidate),
    release: (deck) => deck.release(),
    request: (candidate) => deps().publicApi.requestAuthoritativePlay(candidate.next, {
      resumeAt: 0, crossfadeToken: candidate.token,
      playbackScenario: PLAYBACK_SCENARIOS.QUEUE_AUTO_ADVANCE,
    }, {
      queueEntries: candidate.queue, queueIndex: candidate.nextIndex,
      source: 'autoplay', requireCurrentPlaying: true,
      expectedCurrentMediaIdentity: trackIdentity(candidate.track),
    }),
  });

  function tick() {
    transition.setEnabled(currentEnabled());
    if (tail && (engine.ctx?.state !== 'running' || deps().refs.csModeRef.current ||
        deps().refs.stateRef.current.currentTrack?.metadata?.access?.previewOnly)) finishTail();
    transition.tick();
  }
  const interrupt = () => { transition.cancel(); finishTail(); };
  function detach() {
    subscriptions.forEach((unsubscribe) => unsubscribe());
    subscriptions = [];
  }
  function applyPreference() {
    transition.setEnabled(currentEnabled());
    if (hasEnabledCrossfade() && !subscriptions.length) {
      subscriptions = [
        engine.on(EVENTS.TIMEUPDATE, tick), engine.on(EVENTS.PLAY, tick),
        engine.on(EVENTS.PAUSE, interrupt), engine.on(EVENTS.BUFFERING, interrupt),
        engine.on(EVENTS.STALLED, interrupt), engine.on(EVENTS.ERROR, interrupt),
      ];
    } else if (!hasEnabledCrossfade() && !tail) detach();
  }

  runtime.crossfade = {
    ownsNextPreload() {
      if (!currentEnabled()) return false;
      const current = snapshot();
      return eligiblePair(current) && (Boolean(transition.candidate) || transition.attempted !== current.key);
    },
    dispose() {
      transition.setEnabled(false);
      finishTail();
      detach();
      unsubscribePreference();
      runtime.crossfade = null;
    },
    beforeCommand(command) {
      if (command.type === 'PLAY_TRACK' && command.payload.options?.crossfadeToken != null &&
          command.payload.options.crossfadeToken === transition.candidate?.token) return;
      interrupt();
    },
    // Only this one-shot token, created by the optional owner, may take a prepared
    // deck. An ordinary PLAY_TRACK never enters the adoption branch.
    adopt(track, options) {
      if (options.crossfadeToken == null) return null;
      if (!canBecomeAudible({ ...options, mediaIdentity: trackIdentity(track) })) { interrupt(); return false; }
      const candidate = transition.take(options.crossfadeToken, track);
      if (!candidate) { transition.cancel(); return null; }
      const { refs: r, delegates: d } = deps();
      const deck = candidate.deck;
      const outgoing = r.audioRef.current;
      const outgoingGain = engine.mainGain;
      const previousHls = r.hlsEngineRef.current;
      const duration = Math.min(CROSSFADE_SECONDS, outgoing.duration - outgoing.currentTime);
      if (deck.element.paused || deck.element.currentTime > 0.25 || duration <= 0.25 || !engine.adoptStandbyElement()) {
        deck.release(); return null;
      }
      deck.transfer();
      r.activeStreamAbortRef.current?.abort();
      r.activeStreamAbortRef.current = new AbortController();
      r.playRequestIdRef.current++;
      runtime.audioElement = deck.element;
      r.audioRef.current = deck.element;
      r.sourceRef.current = engine.source;
      r.mainGainRef.current = engine.mainGain;
      r.mediaElementSourceElementRef.current = deck.element;
      r.hlsEngineRef.current = deck.hls;
      setActiveHLSEngine(deck.hls);
      const outgoingMeta = r.streamMetaRef.current;
      r.streamMetaRef.current = null;
      r.queueIndexRef.current = candidate.nextIndex;
      if (r.shuffleRef.current) nextQueueIndex(candidate.queue, candidate.index, r, { advance: true });
      r.lastPlayedSlugRef.current = track.slug;
      if (r.listeningUserIdRef.current) clearPlaybackPosition(r.listeningUserIdRef.current, track.slug);
      r.pendingSeekRef.current = null;
      r.spuriousEndedGuardRef.current = Date.now() + 1000;
      recoveryCoordinator.resetForNewTrack();
      d.patchState({ currentTrack: track, currentTrackId: trackIdentity(track), source: track.source,
        queueIndex: candidate.nextIndex, isPlaying: true, hasStarted: true, playbackState: 'playing',
        isBuffering: false, playbackNetworkState: 'playing', error: null, accessDenied: false,
        streamRetryable: false, streamConflict: null, duration: deck.element.duration });
      d.syncProgressTime(deck.element.currentTime);
      const handlers = runtime.rebindPlaybackElement?.(deck.element);
      if (deck.hls) {
        deck.hls.onError = deck.hls.onSegmentFatalError = () => {
          if (r.audioRef.current === deck.element) {
            interrupt();
            void handlers?.onError();
          }
        };
      }
      // play() was validated silently before ownership changed; publish its normal
      // lifecycle once, now that handlers, identity, queue and refs agree.
      handlers?.onPlay();
      const now = engine.ctx.currentTime;
      const gainDb = track.gainDb ?? track.gain_db ?? track.metadata?.gainDb;
      const incomingGain = Number.isFinite(gainDb) ? Math.max(0.01, Math.min(4, Math.pow(10, gainDb / 20))) : 1;
      const curves = fadeCurves(outgoingGain.gain.value, incomingGain);
      outgoingGain.gain.cancelScheduledValues(now);
      engine.mainGain.gain.cancelScheduledValues(now);
      outgoingGain.gain.setValueCurveAtTime(curves.out, now, duration);
      engine.mainGain.gain.setValueCurveAtTime(curves.incoming, now, duration);
      tail = { audio: outgoing, hls: previousHls, gain: outgoingGain, track: candidate.track, incomingGain, meta: outgoingMeta };
      outgoing.addEventListener('ended', finishTail, { once: true });
      // Timer only releases the now-silent tail; AudioParam automation owns sound.
      tailTimer = setTimeout(finishTail, (duration + 0.05) * 1000);
      deck.element.muted = false;
      return true;
    },
  };
  const unsubscribePreference = subscribeCrossfade(applyPreference);
  initializeCrossfadePreference();
  applyPreference();
}
