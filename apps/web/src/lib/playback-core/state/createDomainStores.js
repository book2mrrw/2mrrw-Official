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

const INITIAL_NOW_PLAYING = Object.freeze({
  trackId:   null,
  releaseId: null,
  title:     null,
  artist:    null,
  cover:     null,
});

const INITIAL_TRANSPORT_STATUS = Object.freeze({
  playing:   false,
  buffering: false,
  seeking:   false,
  error:     null,
});

const INITIAL_TRANSPORT_TIMELINE = Object.freeze({
  position:  0,
  duration:  0,
  buffered:  0,
});

const INITIAL_TRANSPORT_MODE = Object.freeze({
  repeat:  "none",   // "none" | "one" | "all"
  shuffle: false,
  volume:  1.0,
});

const INITIAL_QUEUE = Object.freeze({
  queueId: null,
  entries: [],
  index:   -1,
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

const INITIAL_CONTINUITY = Object.freeze({
  savedPositionSeconds: null,
  sessionPositionSeconds: null,
  releaseId: null,
  trackId:   null,
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
    [StoreKey.NOW_PLAYING,        new DomainStore("nowPlaying",        INITIAL_NOW_PLAYING)],
    [StoreKey.TRANSPORT_STATUS,   new DomainStore("transportStatus",   INITIAL_TRANSPORT_STATUS)],
    [StoreKey.TRANSPORT_TIMELINE, new DomainStore("transportTimeline", INITIAL_TRANSPORT_TIMELINE)],
    [StoreKey.TRANSPORT_MODE,     new DomainStore("transportMode",     INITIAL_TRANSPORT_MODE)],
    [StoreKey.QUEUE,              new DomainStore("queue",             INITIAL_QUEUE)],
    [StoreKey.CAPABILITY,         new DomainStore("capability",        INITIAL_CAPABILITY)],
    [StoreKey.CONTINUITY,         new DomainStore("continuity",        INITIAL_CONTINUITY)],
    [StoreKey.DIAGNOSTICS,        new DomainStore("diagnostics",       INITIAL_DIAGNOSTICS)],
  ]);

  // Seal: no add/delete after creation. Stores themselves remain mutable via _applyCommit.
  return Object.freeze(stores);
}
