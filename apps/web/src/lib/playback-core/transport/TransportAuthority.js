/**
 * TransportAuthority — sole canonical writer for Slice 2 Transport.
 *
 * Physical events and legacy execution completions enter as observations. They
 * are correlated to CoreEpoch + desiredRevision + media identity and only then
 * proposed through CommitGate. Effect authority remains a separate concern.
 */

import {
  Domain,
  StoreKey,
  TransportObservationType as O,
  TransportStatus as S,
} from "../types/index.js";
import { TransportDisposition } from "../desired/DesiredExecutionState.js";

export const PRESENTATION_TIMELINE_INTERVAL_MS = 250;

function identityOf(entry) {
  return entry?.id ?? entry?.trackId ?? entry?.slug ?? null;
}

function deriveStatus(status, fields = {}) {
  return {
    status,
    playing:   status === S.PLAYING,
    paused:    status === S.PAUSED,
    loading:   status === S.LOADING,
    buffering: status === S.BUFFERING,
    seeking:   status === S.SEEKING,
    ended:     status === S.ENDED,
    recovering: status === S.RECOVERING,
    degraded:  status === S.DEGRADED,
    ...fields,
  };
}

function semanticStatusEqual(a, b) {
  const keys = [
    "status", "playing", "paused", "loading", "buffering", "seeking",
    "ended", "recovering", "degraded", "error", "endReason", "networkState",
    "readiness", "mediaIdentity", "desiredRevision", "sourceObservation",
  ];
  return keys.every((key) => a[key] === b[key]);
}

export class TransportAuthority {
  #commitGate;
  #authorityGate;
  #desiredStore;
  #coreEpoch;
  #stores;
  #logger;
  #observationSequence = 0;
  #timelineTimer = null;
  #pendingTimeline = null;
  #lastTimelineCommitAt = 0;
  #metrics = {
    observations: 0,
    accepted: 0,
    rejected: 0,
    timelineObservations: 0,
    timelineCommits: 0,
  };

  constructor({ commitGate, authorityGate, desiredStore, coreEpoch, stores, logger }) {
    this.#commitGate = commitGate;
    this.#authorityGate = authorityGate;
    this.#desiredStore = desiredStore;
    this.#coreEpoch = coreEpoch;
    this.#stores = stores;
    this.#logger = logger;
  }

  captureContext(meta = {}) {
    const desired = this.#desiredStore.current;
    return Object.freeze({
      coreEpoch: this.#coreEpoch.current,
      desiredRevision: desired.revision,
      sourceIntentId: desired.sourceIntentId,
      mediaIdentity:
        meta.mediaIdentity ?? identityOf(meta.mediaEntry) ??
        desired.requestedMediaIdentity ?? null,
      requestId: meta.requestId ?? null,
      source: meta.source ?? "unknown",
      capturedAt: Date.now(),
    });
  }

  get statusSnapshot() {
    return this.#stores.get(StoreKey.TRANSPORT_STATUS).getSnapshot();
  }

  get timelineSnapshot() {
    return this.#stores.get(StoreKey.TRANSPORT_TIMELINE).getSnapshot();
  }

  get modeSnapshot() {
    return this.#stores.get(StoreKey.TRANSPORT_MODE).getSnapshot();
  }

  get metrics() {
    return Object.freeze({ ...this.#metrics });
  }

  subscribeStatus(fn) {
    return this.#stores.get(StoreKey.TRANSPORT_STATUS).subscribe(fn);
  }

  subscribeTimeline(fn) {
    return this.#stores.get(StoreKey.TRANSPORT_TIMELINE).subscribe(fn);
  }

  subscribeMode(fn) {
    return this.#stores.get(StoreKey.TRANSPORT_MODE).subscribe(fn);
  }

  observe(type, payload = {}, context = this.captureContext(payload)) {
    this.#metrics.observations += 1;
    const validation = this.#validateContext(context);
    if (!validation.accepted) return this.#reject(type, context, validation.reason);

    const current = this.statusSnapshot;
    const desired = this.#desiredStore.current;
    const nextStatus = this.#reduceStatus(current, desired, type, payload);
    if (!nextStatus) return this.#reject(type, context, "SEMANTICALLY_STALE");

    const sequence = ++this.#observationSequence;
    const next = Object.freeze({
      ...nextStatus,
      mediaIdentity: context.mediaIdentity ?? desired.requestedMediaIdentity ?? null,
      desiredRevision: desired.revision,
      sourceObservation: type,
      observationSequence: sequence,
      updatedAt: Date.now(),
    });
    if (semanticStatusEqual(current, next)) {
      return { accepted: true, unchanged: true, observationSequence: sequence };
    }
    return this.#commit(StoreKey.TRANSPORT_STATUS, next, context, type);
  }

  observeTimeline(payload = {}, context = this.captureContext(payload), { force = false } = {}) {
    this.#metrics.timelineObservations += 1;
    const validation = this.#validateContext(context);
    if (!validation.accepted) return this.#reject("TIMELINE", context, validation.reason);

    const current = this.timelineSnapshot;
    const candidate = {
      position: Number.isFinite(payload.position) ? Math.max(0, payload.position) : current.position,
      duration: Number.isFinite(payload.duration) ? Math.max(0, payload.duration) : current.duration,
      bufferedEnd: Number.isFinite(payload.bufferedEnd) ? Math.max(0, payload.bufferedEnd) : current.bufferedEnd,
      mediaIdentity: context.mediaIdentity ?? this.#desiredStore.current.requestedMediaIdentity ?? null,
      desiredRevision: context.desiredRevision,
      observedAt: Number.isFinite(payload.observedAt) ? payload.observedAt : Date.now(),
    };
    this.#pendingTimeline = { candidate, context };
    const elapsed = Date.now() - this.#lastTimelineCommitAt;
    if (force || this.#lastTimelineCommitAt === 0 || elapsed >= PRESENTATION_TIMELINE_INTERVAL_MS) {
      return this.#flushTimeline();
    }
    if (!this.#timelineTimer) {
      this.#timelineTimer = setTimeout(() => {
        this.#timelineTimer = null;
        this.#flushTimeline();
      }, PRESENTATION_TIMELINE_INTERVAL_MS - elapsed);
      this.#timelineTimer?.unref?.();
    }
    return { accepted: true, deferred: true };
  }

  observeMode(payload = {}, context = this.captureContext(payload)) {
    const validation = this.#validateContext(context);
    if (!validation.accepted) return this.#reject("MODE", context, validation.reason);
    const current = this.modeSnapshot;
    const next = {
      volume: Number.isFinite(payload.volume)
        ? Math.min(1, Math.max(0, payload.volume))
        : current.volume,
      playbackRate: Number.isFinite(payload.playbackRate)
        ? Math.min(4, Math.max(0.25, payload.playbackRate))
        : current.playbackRate,
      observationSequence: ++this.#observationSequence,
      updatedAt: Date.now(),
    };
    if (next.volume === current.volume && next.playbackRate === current.playbackRate) {
      return { accepted: true, unchanged: true };
    }
    return this.#commit(StoreKey.TRANSPORT_MODE, next, context, "MODE");
  }

  destroy() {
    if (this.#timelineTimer) clearTimeout(this.#timelineTimer);
    this.#timelineTimer = null;
    this.#pendingTimeline = null;
  }

  #validateContext(context) {
    const desired = this.#desiredStore.current;
    if (!context || context.coreEpoch !== this.#coreEpoch.current) {
      return { accepted: false, reason: "CORE_EPOCH_MISMATCH" };
    }
    if (context.desiredRevision !== desired.revision) {
      return { accepted: false, reason: "DESIRED_REVISION_MISMATCH" };
    }
    if (context.sourceIntentId !== desired.sourceIntentId) {
      return { accepted: false, reason: "SOURCE_INTENT_MISMATCH" };
    }
    if (
      context.mediaIdentity && desired.requestedMediaIdentity &&
      context.mediaIdentity !== desired.requestedMediaIdentity
    ) {
      return { accepted: false, reason: "MEDIA_IDENTITY_MISMATCH" };
    }
    if (!this.#authorityGate.authoritativeIntent) {
      return { accepted: false, reason: "NO_AUTHORITATIVE_INTENT" };
    }
    return { accepted: true };
  }

  #reduceStatus(current, desired, type, payload) {
    const wantsPlay = desired.desiredTransport === TransportDisposition.PLAYING;
    const wantsPause = desired.desiredTransport === TransportDisposition.PAUSED;
    const base = {
      error: payload.error ?? (type === O.PHYSICAL_ERROR ? "PLAYBACK_ERROR" : current.error),
      endReason: payload.endReason ?? current.endReason ?? null,
      networkState: payload.networkState ?? current.networkState,
      readiness: payload.readiness ?? current.readiness,
    };

    switch (type) {
      case O.EXECUTION_LOADING:
        return deriveStatus(S.LOADING, { ...base, error: null, networkState: payload.networkState ?? "loading_stream", readiness: "LOADING" });
      case O.PHYSICAL_PLAY:
        return wantsPlay
          ? deriveStatus(current.status === S.BUFFERING ? S.BUFFERING : S.LOADING, { ...base, error: null, readiness: "HAVE_CURRENT_DATA" })
          : null;
      case O.PHYSICAL_PLAYING:
        return wantsPlay
          ? deriveStatus(S.PLAYING, { ...base, error: null, networkState: "playing", readiness: "PLAYABLE" })
          : null;
      case O.PHYSICAL_PAUSE:
        if (wantsPause) return deriveStatus(S.PAUSED, { ...base, networkState: "idle" });
        if (wantsPlay && payload.interruption) {
          return deriveStatus(S.RECOVERING, { ...base, networkState: "interrupted" });
        }
        return null;
      case O.PHYSICAL_WAITING:
      case O.PHYSICAL_STALLED:
        return wantsPlay
          ? deriveStatus(S.BUFFERING, { ...base, networkState: payload.networkState ?? "buffering" })
          : null;
      case O.PHYSICAL_CANPLAY:
        return wantsPlay
          ? deriveStatus(current.status === S.SEEKING ? S.SEEKING : S.LOADING, { ...base, readiness: "PLAYABLE" })
          : current;
      case O.PHYSICAL_SEEKING:
        return desired.positionTarget != null
          ? deriveStatus(S.SEEKING, { ...base })
          : null;
      case O.PHYSICAL_SEEKED:
        if (current.status !== S.SEEKING) return null;
        if (
          desired.positionTarget != null && Number.isFinite(payload.position) &&
          Math.abs(payload.position - desired.positionTarget) > 0.75
        ) return null;
        return deriveStatus(wantsPlay ? (payload.playing ? S.PLAYING : S.LOADING) : S.PAUSED, { ...base });
      case O.PHYSICAL_ENDED:
        return wantsPlay ? deriveStatus(S.ENDED, { ...base, endReason: payload.endReason ?? "natural", networkState: "idle" }) : null;
      case O.PHYSICAL_ERROR:
        return deriveStatus(S.ERROR, { ...base, networkState: payload.networkState ?? "error_stream" });
      case O.RECOVERY_STARTED:
        return deriveStatus(S.RECOVERING, { ...base, networkState: payload.networkState ?? "recovering" });
      case O.RECOVERY_COMPLETED:
        return deriveStatus(payload.playing && wantsPlay ? S.PLAYING : S.PAUSED, { ...base, error: null, networkState: payload.playing && wantsPlay ? "playing" : "idle" });
      case O.RECOVERY_FAILED:
        return deriveStatus(S.DEGRADED, { ...base, error: payload.error ?? "RECOVERY_FAILED", networkState: "degraded" });
      case O.EXECUTION_RESULT:
      case O.LEGACY_PROJECTION:
        return this.#reduceLegacyProjection(current, desired, payload, base);
      default:
        return null;
    }
  }

  #reduceLegacyProjection(current, desired, payload, base) {
    const wantsPlay = desired.desiredTransport === TransportDisposition.PLAYING;
    const wantsPause = desired.desiredTransport === TransportDisposition.PAUSED;
    const state = payload.playbackState;
    const network = payload.playbackNetworkState ?? payload.networkState;
    if (network === "error_stream") {
      return deriveStatus(S.ERROR, { ...base, error: payload.error ?? "STREAM_ERROR", networkState: network });
    }
    if (state === "recovering" || network === "recovering" || network === "retrying_stream") {
      return deriveStatus(S.RECOVERING, { ...base, networkState: network ?? "recovering" });
    }
    if (state === "loading" || state === "ready" || network === "loading_stream") {
      return wantsPlay ? deriveStatus(S.LOADING, { ...base, error: null, networkState: network ?? "loading_stream", readiness: state === "ready" ? "PLAYABLE" : "LOADING" }) : null;
    }
    if (payload.isBuffering === true || network === "buffering") {
      return wantsPlay ? deriveStatus(S.BUFFERING, { ...base, networkState: network ?? "buffering" }) : null;
    }
    if (state === "playing" && payload.physicallyConfirmed === true) {
      return wantsPlay ? deriveStatus(S.PLAYING, { ...base, error: null, networkState: "playing", readiness: "PLAYABLE" }) : null;
    }
    if ((state === "paused" || payload.isPlaying === false) && wantsPause) {
      return deriveStatus(S.PAUSED, { ...base, networkState: "idle" });
    }
    if (state === "ending" || state === "ended_preview") {
      return wantsPlay ? deriveStatus(S.ENDED, { ...base, endReason: state === "ended_preview" ? "preview" : "natural", networkState: "idle" }) : null;
    }
    if (state === "idle" && !wantsPlay) {
      return deriveStatus(S.IDLE, { ...base, networkState: "idle", readiness: "EMPTY" });
    }
    return null;
  }

  #flushTimeline() {
    const pending = this.#pendingTimeline;
    this.#pendingTimeline = null;
    if (!pending) return { accepted: true, unchanged: true };
    const validation = this.#validateContext(pending.context);
    if (!validation.accepted) return this.#reject("TIMELINE", pending.context, validation.reason);
    const current = this.timelineSnapshot;
    const candidate = pending.candidate;
    if (
      current.position === candidate.position &&
      current.duration === candidate.duration &&
      current.bufferedEnd === candidate.bufferedEnd &&
      current.mediaIdentity === candidate.mediaIdentity
    ) {
      return { accepted: true, unchanged: true };
    }
    const next = {
      ...candidate,
      observationSequence: ++this.#observationSequence,
      presentedAt: Date.now(),
    };
    const result = this.#commit(StoreKey.TRANSPORT_TIMELINE, next, pending.context, "TIMELINE");
    if (result.accepted) {
      this.#lastTimelineCommitAt = Date.now();
      this.#metrics.timelineCommits += 1;
    }
    return result;
  }

  #commit(storeKey, snapshot, context, type) {
    const result = this.#commitGate.propose({
      intent: this.#authorityGate.authoritativeIntent,
      storeKey,
      domain: Domain.TRANSPORT,
      snapshot,
      context: { ...context, observationType: type },
    });
    if (result.accepted) this.#metrics.accepted += 1;
    else this.#metrics.rejected += 1;
    return result;
  }

  #reject(type, context, reason) {
    this.#metrics.rejected += 1;
    this.#logger?.emit({
      type: "TRANSPORT_OBSERVATION_REJECTED",
      observationType: type,
      reason,
      desiredRevision: context?.desiredRevision ?? null,
      mediaIdentity: context?.mediaIdentity ?? null,
      requestId: context?.requestId ?? null,
    });
    return { accepted: false, rejectionReason: reason };
  }
}
