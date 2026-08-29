/**
 * createDomainStores — factory that instantiates all canonical state domains.
 *
 * Each domain is an independent DomainStore. They share NO subscription channel.
 * Committing to transportTimeline notifies ONLY transportTimeline subscribers —
 * never nowPlaying, queue, or any other domain. This is the key invariant that
 * prevents position clock ticks from re-rendering album artwork or queue rows.
 *
 * Hot/cold split within transport (Invariant — locked):
 *   transportStatus   — playing, buffering, seeking (low-frequency state changes)
 *   transportTimeline — position, duration, buffered (high-frequency, ~4 Hz push)
 *   transportMode     — repeat, shuffle, volume     (rare mutations)
 *
 * TransportTimeline is the ONLY domain that updates at human-audible rates.
 * All other domains update only on meaningful state transitions.
 *
 * Domain keys match StoreKey constants from types/index.js.
 */

import { DomainStore } from "./DomainStore.js";
import { StoreKey } from "../types/index.js";

// ─── Initial snapshots ────────────────────────────────────────────────────────
// All null / zero / false initial states. Populated by Core during execution.

// Slice 3 — the atomic Selection snapshot. NowPlaying + Queue + QueueIndex
// commit together through SelectionAuthority; a subscriber can never observe
// one field ahead of the others. Repeat/shuffle are queue-traversal policy —
// they migrate with Selection, per the original Slice 2 deferral in
// INITIAL_TRANSPORT_MODE below. shuffleOrder/shufflePosition are internal
// traversal state (not part of any public compatibility shape) needed so NEXT
// produces a deterministic, non-repeating shuffle sequence for the active queue.
const INITIAL_SELECTION = Object.freeze({
  nowPlaying:      null,
  queue:           Object.freeze([]),
  queueIndex:      -1,
  repeatMode:      "off",
  shuffle:         false,
  shuffleOrder:    null,
  shufflePosition: 0,
  selectionVersion: 0,
  updatedAt:       0,
});

const INITIAL_TRANSPORT_STATUS = Object.freeze({
  status:               "IDLE",
  playing:              false,
  paused:               false,
  loading:              false,
  buffering:            false,
  seeking:              false,
  ended:                false,
  recovering:           false,
  degraded:             false,
  error:                null,
  endReason:            null,
  networkState:         "idle",
  readiness:            "EMPTY",
  mediaIdentity:        null,
  desiredRevision:      0,
  sourceObservation:    null,
  observationSequence:  0,
  updatedAt:            0,
});

const INITIAL_TRANSPORT_TIMELINE = Object.freeze({
  position:             0,
  duration:             0,
  bufferedEnd:          0,
  mediaIdentity:        null,
  desiredRevision:      0,
  observationSequence:  0,
  observedAt:           0,
  presentedAt:          0,
});

const INITIAL_TRANSPORT_MODE = Object.freeze({
  // Repeat and shuffle are queue-traversal policy and remain with legacy
  // Selection until NowPlaying + Queue + QueueIndex migrate atomically.
  volume:               1.0,
  playbackRate:         1.0,
  observationSequence:  0,
  updatedAt:            0,
});

const INITIAL_CAPABILITY = Object.freeze({
  fingerprint:               null,
  canStreamFull:             false,
  previewDurationSeconds:    15,
  canDownload:               false,
  vaultAccess:               false,
  offlineAccess:             false,
  playbackTier:              "entry",
});

// Slice 4D — bookkeeping about the last VALIDATED continuity candidate, not a
// second canonical copy of Selection/Transport truth. Selection restoration
// still commits exclusively through SelectionAuthority; position restoration
// still lands through the existing SEEK/resumePolicy path. This store only
// records what ContinuityAuthority most recently accepted, for observability
// and for "is there anything to restore" checks — restoring FROM it always
// re-validates against current authority at proposal time (INV-CONT-1/2/3).
const INITIAL_CONTINUITY = Object.freeze({
  schemaVersion:          null,
  mediaIdentity:          null,
  releaseId:              null,
  trackId:                null,
  savedPositionSeconds:   null,
  sessionPositionSeconds: null,
  capturedAt:             null,
  validatedAt:            null,
});

const INITIAL_DIAGNOSTICS = Object.freeze({
  lastEventType:     null,
  lastIntentId:      null,
  lastCommitResult:  null,
  totalCommits:      0,
  totalRejections:   0,
});

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Creates and returns a Map of all domain stores, keyed by StoreKey constant.
 * The Map itself is sealed after creation — domains cannot be added or removed.
 *
 * @returns {Map<string, DomainStore>}
 */
export function createDomainStores() {
  const stores = new Map([
    [StoreKey.SELECTION,          new DomainStore("selection",         INITIAL_SELECTION)],
    [StoreKey.TRANSPORT_STATUS,   new DomainStore("transportStatus",   INITIAL_TRANSPORT_STATUS)],
    [StoreKey.TRANSPORT_TIMELINE, new DomainStore("transportTimeline", INITIAL_TRANSPORT_TIMELINE)],
    [StoreKey.TRANSPORT_MODE,     new DomainStore("transportMode",     INITIAL_TRANSPORT_MODE)],
    [StoreKey.CAPABILITY,         new DomainStore("capability",        INITIAL_CAPABILITY)],
    [StoreKey.CONTINUITY,         new DomainStore("continuity",        INITIAL_CONTINUITY)],
    [StoreKey.DIAGNOSTICS,        new DomainStore("diagnostics",       INITIAL_DIAGNOSTICS)],
  ]);

  // Seal: no add/delete after creation. Stores themselves remain mutable via _applyCommit.
  return Object.freeze(stores);
}
