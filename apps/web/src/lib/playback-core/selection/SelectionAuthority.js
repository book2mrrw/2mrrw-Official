/**
 * SelectionAuthority — sole canonical writer for Slice 3 Selection.
 *
 * Selection is the atomic triple { nowPlaying, queue, queueIndex } plus the
 * traversal policy that decides how NEXT/PREVIOUS move through it
 * (repeatMode, shuffle). All three identity fields commit together through
 * ONE DomainStore (StoreKey.SELECTION) — a subscriber can never observe
 * nowPlaying updated without queue/queueIndex, or vice versa.
 *
 * Unlike TransportAuthority (which correlates PHYSICAL OBSERVATIONS against a
 * separately-authoritative desired execution state), Selection has no physical
 * layer to observe: a Selection command IS the decision. Selection therefore
 * does not share AuthorityGate/CommitGate wiring with Transport's PLAY/PAUSE/
 * RESUME/SEEK intents — coupling them would let an unrelated Selection action
 * spuriously supersede an in-flight Transport intent. Instead this class holds
 * its own dedicated AuthorityGate + CommitGate pair (constructed in
 * PlaybackCore, sharing the same underlying DomainStore map, ownership
 * registry, and logger), used purely as the commit envelope CommitGate.propose
 * requires. Every SelectionAuthority commit registers-then-proposes its own
 * intent synchronously, so Gate 1 (authority) is structurally always satisfied
 * here; Gate 2 (domain ownership) is the gate that actually matters for
 * Selection and is left completely intact.
 *
 * STALENESS MODEL:
 *   Identity-changing transitions (setQueueAndSelect, selectIndex, selectMedia,
 *   next, previous, insertItem, removeItem, reorderQueue, replaceQueue,
 *   clearQueue, restoreSelection, setTraversalPolicy) validate a captured
 *   context against the CURRENT coreEpoch and selectionVersion. A caller that
 *   captures context synchronously right before proposing (the default) always
 *   validates trivially. A caller that captures context before doing async work
 *   (session restore) and proposes after — the only real async Selection
 *   proposer in this codebase — is rejected if anything committed in between
 *   (INV-SELECTION-5, INV-SELECTION-11).
 *
 *   Representation-only transitions (updateNowPlayingRepresentation,
 *   updateQueueRepresentation) do not change WHICH media is selected, so they
 *   validate identity-match instead of version-match: a delayed src refresh
 *   for the still-current track is accepted even if unrelated fields (e.g.
 *   traversal policy) changed in the meantime, but a refresh for a track that
 *   is no longer canonical is rejected. They still validate coreEpoch.
 */

import { Domain, StoreKey, SelectionTransitionType as T, CommitRejectionReason } from "../types/index.js";

export const EMPTY_SELECTION_QUEUE_INDEX = -1;

function identityOf(entry) {
  return entry?.id ?? entry?.trackId ?? entry?.slug ?? null;
}

function clampIndex(index, length) {
  if (!Number.isInteger(index)) return -1;
  if (length <= 0) return -1;
  return Math.max(0, Math.min(index, length - 1));
}

function isEmptySnapshot(queue, index) {
  return !Array.isArray(queue) || queue.length === 0 || index < 0;
}

/** Minimal, dependency-free Fisher-Yates over an index array. Kept local so
 * Core stays framework/legacy-independent (no import from `@/lib/playback`). */
function shuffledIndexOrder(length) {
  const order = Array.from({ length }, (_, i) => i);
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

/**
 * Build a shuffle traversal order for one full cycle: position 0 is always
 * `currentIndex` (the track already playing, never itself returned as a
 * "next" pick), followed by a random permutation of every OTHER index.
 * Pinning position 0 deterministically — rather than placing currentIndex
 * randomly and special-casing only the "landed on 0" case — guarantees every
 * other track is visited exactly once before any repeat, regardless of where
 * a naive full-array shuffle would have happened to place currentIndex.
 */
function buildShuffleOrder(length, currentIndex) {
  const others = [];
  for (let i = 0; i < length; i += 1) {
    if (i !== currentIndex) others.push(i);
  }
  const permutedPositions = shuffledIndexOrder(others.length);
  return [currentIndex, ...permutedPositions.map((pos) => others[pos])];
}

/** Same identities in the same order — a "same queue" re-selection must not
 * discard the in-progress shuffle permutation (shuffle stability). */
function queueContentMatches(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (identityOf(a[i]) !== identityOf(b[i])) return false;
  }
  return true;
}

export class SelectionAuthority {
  #commitGate;
  #selectionAuthorityGate;
  #coreEpoch;
  #stores;
  #logger;
  #sequence = 0;
  #metrics = { proposals: 0, accepted: 0, rejected: 0 };

  constructor({ commitGate, selectionAuthorityGate, coreEpoch, stores, logger }) {
    this.#commitGate = commitGate;
    this.#selectionAuthorityGate = selectionAuthorityGate;
    this.#coreEpoch = coreEpoch;
    this.#stores = stores;
    this.#logger = logger;
  }

  get snapshot() {
    return this.#stores.get(StoreKey.SELECTION).getSnapshot();
  }

  get metrics() {
    return Object.freeze({ ...this.#metrics });
  }

  subscribe(fn) {
    return this.#stores.get(StoreKey.SELECTION).subscribe(fn);
  }

  /** Capture a proposal context. Call once, synchronously, right before the
   * intended commit for synchronous callers (the default everywhere except
   * session restore). Session restore calls this BEFORE its async fetch and
   * passes the captured context back in once the fetch resolves. */
  captureContext(meta = {}) {
    return Object.freeze({
      coreEpoch: this.#coreEpoch.current,
      selectionVersionAtCapture: this.snapshot.selectionVersion,
      source: meta.source ?? "unknown",
      requestId: meta.requestId ?? null,
      capturedAt: Date.now(),
    });
  }

  // ─── Identity-changing transitions ───────────────────────────────────────

  setQueueAndSelect(queueEntries, queueIndex, context = this.captureContext()) {
    if (!Array.isArray(queueEntries)) {
      return this.#rejectInvalid(T.SET_QUEUE_AND_SELECT, context, "queueEntries must be an array");
    }
    const index = clampIndex(queueIndex, queueEntries.length);
    const current = this.snapshot;
    const resetShuffle = !queueContentMatches(current.queue, queueEntries);
    return this.#commitFullSnapshot(T.SET_QUEUE_AND_SELECT, queueEntries, index, context, { resetShuffle });
  }

  selectIndex(index, context = this.captureContext()) {
    const current = this.snapshot;
    if (!Number.isInteger(index) || index < 0 || index >= current.queue.length) {
      return this.#rejectInvalid(T.SELECT_INDEX, context, "index out of bounds");
    }
    return this.#commitFullSnapshot(T.SELECT_INDEX, current.queue, index, context, { resetShuffle: false });
  }

  /**
   * Select by media identity/entry. Mirrors the legacy requestAuthoritativePlay
   * resolution order: an explicit valid index wins if its identity matches;
   * otherwise search the current queue by identity; otherwise the entry
   * becomes a fresh single-item queue (matches legacy's `[track]` fallback).
   */
  selectMedia(entry, { preferredIndex } = {}, context = this.captureContext()) {
    const current = this.snapshot;
    const targetIdentity = identityOf(entry);
    if (!targetIdentity) {
      return this.#rejectInvalid(T.SELECT_MEDIA, context, "entry has no resolvable identity");
    }
    let index = Number.isInteger(preferredIndex) ? preferredIndex : -1;
    if (index < 0 || index >= current.queue.length || identityOf(current.queue[index]) !== targetIdentity) {
      index = current.queue.findIndex((e) => identityOf(e) === targetIdentity);
    }
    if (index >= 0) {
      return this.#commitFullSnapshot(T.SELECT_MEDIA, current.queue, index, context, { resetShuffle: false });
    }
    return this.#commitFullSnapshot(T.SELECT_MEDIA, [entry], 0, context, { resetShuffle: true });
  }

  /**
   * @param {{repeatMode:string, shuffle:boolean, autoAdvance?:boolean, isPlayable?:(e)=>boolean}} payload
   */
  next(payload, context = this.captureContext(payload)) {
    return this.#advance(1, T.NEXT, payload, context);
  }

  /**
   * @param {{repeatMode:string, isPlayable?:(e)=>boolean}} payload
   * Restart-current-track-if->3s and seek concerns belong to the caller — this
   * method only ever moves the queue index, mirroring legacy playPreviousInternal
   * once past its currentTime>3 short-circuit.
   */
  previous(payload, context = this.captureContext(payload)) {
    return this.#advance(-1, T.PREVIOUS, payload, context);
  }

  #advance(direction, type, payload = {}, context) {
    const validation = this.#validateContext(context);
    if (!validation.accepted) return this.#reject(type, context, validation.reason);

    const current = this.snapshot;
    const { queue, queueIndex } = current;
    const repeatMode = payload.repeatMode ?? current.repeatMode;
    const shuffle = Boolean(payload.shuffle ?? current.shuffle);
    const autoAdvance = Boolean(payload.autoAdvance);
    const isPlayable = typeof payload.isPlayable === "function" ? payload.isPlayable : () => true;

    if (isEmptySnapshot(queue, queueIndex) || queue.length === 0) {
      return { accepted: true, unchanged: true, snapshot: current, endOfQueue: false };
    }

    let shuffleOrder = current.shuffleOrder;
    let shufflePosition = current.shufflePosition;
    let candidate;
    let endOfQueue = false;

    if (direction > 0 && shuffle && queue.length > 1) {
      if (!Array.isArray(shuffleOrder) || shuffleOrder.length !== queue.length) {
        shuffleOrder = buildShuffleOrder(queue.length, queueIndex);
        shufflePosition = 0;
      }
      let pos = shufflePosition;
      candidate = -1;
      for (let attempts = 0; attempts <= queue.length; attempts += 1) {
        pos += 1;
        if (pos >= shuffleOrder.length) {
          // Cycle exhausted — every other track has been offered once.
          // Reshuffle for a new cycle, still excluding the track playing now.
          shuffleOrder = buildShuffleOrder(queue.length, queueIndex);
          pos = 0;
          continue;
        }
        const idx = shuffleOrder[pos];
        if (isPlayable(queue[idx])) {
          candidate = idx;
          shufflePosition = pos;
          break;
        }
      }
      if (candidate < 0) endOfQueue = true;
    } else {
      let idx = queueIndex + direction;
      let attempts = 0;
      candidate = -1;
      while (attempts < queue.length + 1) {
        if (idx < 0) {
          if (repeatMode === "all") idx = queue.length - 1;
          else if (direction < 0 && attempts === 0) idx = 0; // legacy: PREVIOUS at start jumps to track 1
          else { endOfQueue = true; break; }
        } else if (idx >= queue.length) {
          if (repeatMode === "all") idx = 0;
          else { endOfQueue = true; break; }
        }
        if (isPlayable(queue[idx])) { candidate = idx; break; }
        idx += direction;
        attempts += 1;
      }
    }

    if (endOfQueue || candidate < 0) {
      if (direction > 0 && autoAdvance) {
        // Legacy onEnded behavior: silently wrap to track 1 and stay paused —
        // this IS a Selection change (identity moves to queue[0]), but the
        // caller decides not to initiate playback.
        const snapshot = this.#buildSnapshot(current, queue, 0, {
          shuffleOrder: shuffle ? shuffleOrder : null,
          shufflePosition: shuffle ? 0 : 0,
        });
        const result = this.#commit(type, snapshot, context);
        return { ...result, endOfQueue: true };
      }
      return { accepted: true, unchanged: true, snapshot: current, endOfQueue: true };
    }

    const snapshot = this.#buildSnapshot(current, queue, candidate, { shuffleOrder, shufflePosition });
    const result = this.#commit(type, snapshot, context);
    return { ...result, endOfQueue: false };
  }

  removeItem(index, context = this.captureContext()) {
    const validation = this.#validateContext(context);
    if (!validation.accepted) return this.#reject(T.REMOVE_ITEM, context, validation.reason);
    const current = this.snapshot;
    if (!Number.isInteger(index) || index < 0 || index >= current.queue.length) {
      return this.#rejectInvalid(T.REMOVE_ITEM, context, "index out of bounds");
    }
    if (index === current.queueIndex) {
      return this.#rejectInvalid(T.REMOVE_ITEM, context, "cannot remove the currently selected item");
    }
    const nextQueue = current.queue.slice(0, index).concat(current.queue.slice(index + 1));
    const nextIndex = index < current.queueIndex ? current.queueIndex - 1 : current.queueIndex;
    return this.#commit(T.REMOVE_ITEM, this.#buildSnapshot(current, nextQueue, nextIndex, {}), context);
  }

  insertItem(entry, { atIndex, playNext = false } = {}, context = this.captureContext()) {
    const validation = this.#validateContext(context);
    if (!validation.accepted) return this.#reject(T.INSERT_ITEM, context, validation.reason);
    const current = this.snapshot;
    if (current.queue.length === 0) {
      return this.#commit(T.INSERT_ITEM, this.#buildSnapshot(current, [entry], 0, {}), context);
    }
    let insertAt = Number.isInteger(atIndex)
      ? Math.max(0, Math.min(atIndex, current.queue.length))
      : playNext
        ? current.queueIndex + 1
        : current.queue.length;
    const nextQueue = current.queue.slice(0, insertAt).concat([entry], current.queue.slice(insertAt));
    const nextIndex = insertAt <= current.queueIndex ? current.queueIndex + 1 : current.queueIndex;
    return this.#commit(T.INSERT_ITEM, this.#buildSnapshot(current, nextQueue, nextIndex, {}), context);
  }

  reorderQueue(fromIndex, toIndex, context = this.captureContext()) {
    const validation = this.#validateContext(context);
    if (!validation.accepted) return this.#reject(T.REORDER_QUEUE, context, validation.reason);
    const current = this.snapshot;
    if (
      !Number.isInteger(fromIndex) || !Number.isInteger(toIndex) ||
      fromIndex < 0 || fromIndex >= current.queue.length ||
      toIndex < 0 || toIndex >= current.queue.length
    ) {
      return this.#rejectInvalid(T.REORDER_QUEUE, context, "index out of bounds");
    }
    if (fromIndex === toIndex) return { accepted: true, unchanged: true, snapshot: current };
    if (fromIndex === current.queueIndex) {
      return this.#rejectInvalid(T.REORDER_QUEUE, context, "cannot reorder the currently selected item");
    }
    const nextQueue = current.queue.slice();
    const [moved] = nextQueue.splice(fromIndex, 1);
    nextQueue.splice(toIndex, 0, moved);
    const playingIdx = current.queueIndex;
    let nextIndex = playingIdx;
    if (fromIndex < playingIdx && toIndex >= playingIdx) nextIndex = playingIdx - 1;
    else if (fromIndex > playingIdx && toIndex <= playingIdx) nextIndex = playingIdx + 1;
    return this.#commit(T.REORDER_QUEUE, this.#buildSnapshot(current, nextQueue, nextIndex, {}), context);
  }

  /**
   * Replace the queue wholesale. Resolves the surviving selection deterministically:
   * the current identity's occurrence in the new entries if present (nearest to the
   * same numeric index on ties), else the same numeric index clamped, else empty.
   */
  replaceQueue(nextEntries, context = this.captureContext()) {
    if (!Array.isArray(nextEntries)) {
      return this.#rejectInvalid(T.REPLACE_QUEUE, context, "nextEntries must be an array");
    }
    const validation = this.#validateContext(context);
    if (!validation.accepted) return this.#reject(T.REPLACE_QUEUE, context, validation.reason);
    const current = this.snapshot;
    if (nextEntries.length === 0) {
      return this.#commit(T.REPLACE_QUEUE, this.#buildSnapshot(current, [], -1, {}), context);
    }
    const currentIdentity = identityOf(current.nowPlaying);
    let nextIndex = currentIdentity ? nextEntries.findIndex((e) => identityOf(e) === currentIdentity) : -1;
    if (nextIndex < 0) nextIndex = clampIndex(current.queueIndex, nextEntries.length);
    return this.#commit(T.REPLACE_QUEUE, this.#buildSnapshot(current, nextEntries, nextIndex, {}), context);
  }

  clearQueue(context = this.captureContext()) {
    const validation = this.#validateContext(context);
    if (!validation.accepted) return this.#reject(T.CLEAR_QUEUE, context, validation.reason);
    const current = this.snapshot;
    if (isEmptySnapshot(current.queue, current.queueIndex)) {
      return { accepted: true, unchanged: true, snapshot: current };
    }
    return this.#commit(T.CLEAR_QUEUE, this.#buildSnapshot(current, [], -1, { shuffleOrder: null, shufflePosition: 0 }), context);
  }

  /**
   * Bootstrap-only: only accepted while the captured context's
   * selectionVersionAtCapture still matches — i.e. nothing else committed
   * between the moment restore was initiated (before its async fetch) and the
   * moment it resolved. A user selection made in between always wins
   * (INV-SELECTION-11).
   */
  restoreSelection({ queue, queueIndex, repeatMode, shuffle }, context = this.captureContext()) {
    if (!Array.isArray(queue)) {
      return this.#rejectInvalid(T.RESTORE_SELECTION, context, "queue must be an array");
    }
    const validation = this.#validateContext(context);
    if (!validation.accepted) return this.#reject(T.RESTORE_SELECTION, context, validation.reason);
    const index = clampIndex(queueIndex, queue.length);
    const current = this.snapshot;
    return this.#commit(T.RESTORE_SELECTION, this.#buildSnapshot(current, queue, index, {
      repeatMode: repeatMode ?? current.repeatMode,
      shuffle: Boolean(shuffle ?? current.shuffle),
      shuffleOrder: null,
      shufflePosition: 0,
    }), context);
  }

  setTraversalPolicy({ repeatMode, shuffle }, context = this.captureContext()) {
    const validation = this.#validateContext(context);
    if (!validation.accepted) return this.#reject(T.SET_TRAVERSAL_POLICY, context, validation.reason);
    const current = this.snapshot;
    const nextRepeat = repeatMode !== undefined ? repeatMode : current.repeatMode;
    const nextShuffle = shuffle !== undefined ? Boolean(shuffle) : current.shuffle;
    if (nextRepeat === current.repeatMode && nextShuffle === current.shuffle) {
      return { accepted: true, unchanged: true, snapshot: current };
    }
    const resetShuffleTraversal = nextShuffle === false && current.shuffle === true;
    return this.#commit(T.SET_TRAVERSAL_POLICY, this.#buildSnapshot(current, current.queue, current.queueIndex, {
      repeatMode: nextRepeat,
      shuffle: nextShuffle,
      shuffleOrder: resetShuffleTraversal ? null : current.shuffleOrder,
      shufflePosition: resetShuffleTraversal ? 0 : current.shufflePosition,
    }), context);
  }

  // ─── Representation-only transitions (identity unchanged) ────────────────

  /** Refresh fields on the CURRENT nowPlaying entry (resolved src, upgraded
   * access flags, CS-mode variant, recovered src). Never changes WHO is
   * selected — rejected if the patch's identity doesn't match canonical
   * nowPlaying, so a legacy path can never sneak in a new selection here. */
  updateNowPlayingRepresentation(patch, context = this.captureContext()) {
    const current = this.snapshot;
    if (!current.nowPlaying) {
      return this.#rejectInvalid(T.UPDATE_NOW_PLAYING_REPRESENTATION, context, "no current selection");
    }
    const patchIdentity = identityOf(patch);
    if (patchIdentity && patchIdentity !== identityOf(current.nowPlaying)) {
      return this.#rejectInvalid(T.UPDATE_NOW_PLAYING_REPRESENTATION, context, "identity mismatch");
    }
    if (context && context.coreEpoch !== this.#coreEpoch.current) {
      return this.#reject(T.UPDATE_NOW_PLAYING_REPRESENTATION, context, CommitRejectionReason.SELECTION_EPOCH_MISMATCH);
    }
    const merged = { ...current.nowPlaying, ...patch };
    const nextQueue = current.queue.slice();
    if (current.queueIndex >= 0 && current.queueIndex < nextQueue.length) {
      nextQueue[current.queueIndex] = merged;
    }
    const snapshot = {
      ...current,
      nowPlaying: merged,
      queue: nextQueue,
      updatedAt: Date.now(),
    };
    return this.#commitRaw(T.UPDATE_NOW_PLAYING_REPRESENTATION, snapshot, context);
  }

  /** Refresh entries in place (e.g. entitlement/access-flag upgrades across the
   * queue). Rejected unless the new array is the same length with the same
   * identity at every index — order/identity changes must go through the
   * identity-changing transitions instead. */
  updateQueueRepresentation(updatedEntries, context = this.captureContext()) {
    const current = this.snapshot;
    if (!Array.isArray(updatedEntries) || updatedEntries.length !== current.queue.length) {
      return this.#rejectInvalid(T.UPDATE_QUEUE_REPRESENTATION, context, "shape mismatch");
    }
    for (let i = 0; i < updatedEntries.length; i += 1) {
      if (identityOf(updatedEntries[i]) !== identityOf(current.queue[i])) {
        return this.#rejectInvalid(T.UPDATE_QUEUE_REPRESENTATION, context, "identity/order mismatch");
      }
    }
    if (context && context.coreEpoch !== this.#coreEpoch.current) {
      return this.#reject(T.UPDATE_QUEUE_REPRESENTATION, context, CommitRejectionReason.SELECTION_EPOCH_MISMATCH);
    }
    const nowPlaying = current.queueIndex >= 0 ? updatedEntries[current.queueIndex] ?? current.nowPlaying : current.nowPlaying;
    const snapshot = { ...current, queue: updatedEntries, nowPlaying, updatedAt: Date.now() };
    return this.#commitRaw(T.UPDATE_QUEUE_REPRESENTATION, snapshot, context);
  }

  // ─── Internal ─────────────────────────────────────────────────────────────

  #validateContext(context) {
    if (!context) return { accepted: false, reason: CommitRejectionReason.SELECTION_INVALID };
    if (context.coreEpoch !== this.#coreEpoch.current) {
      return { accepted: false, reason: CommitRejectionReason.SELECTION_EPOCH_MISMATCH };
    }
    if (context.selectionVersionAtCapture !== this.snapshot.selectionVersion) {
      return { accepted: false, reason: CommitRejectionReason.SELECTION_VERSION_STALE };
    }
    return { accepted: true };
  }

  #buildSnapshot(current, queue, index, overrides) {
    const resolvedIndex = isEmptySnapshot(queue, index) ? -1 : index;
    const nowPlaying = resolvedIndex >= 0 ? queue[resolvedIndex] : null;
    return {
      ...current,
      nowPlaying,
      queue,
      queueIndex: resolvedIndex,
      ...overrides,
      updatedAt: Date.now(),
    };
  }

  /** Commit an identity-relevant snapshot — always bumps selectionVersion when
   * the triple (nowPlaying identity, queue, queueIndex) actually changed. */
  #commit(type, snapshot, context) {
    const current = this.snapshot;
    const unchanged =
      current.queueIndex === snapshot.queueIndex &&
      current.queue.length === snapshot.queue.length &&
      current.queue.every((e, i) => e === snapshot.queue[i]) &&
      current.repeatMode === snapshot.repeatMode &&
      current.shuffle === snapshot.shuffle;
    if (unchanged) {
      return { accepted: true, unchanged: true, snapshot: current };
    }
    const finalSnapshot = { ...snapshot, selectionVersion: current.selectionVersion + 1 };
    return this.#commitRaw(type, finalSnapshot, context);
  }

  #commitRaw(type, snapshot, context) {
    this.#metrics.proposals += 1;
    const seq = ++this.#sequence;
    const intent = Object.freeze({ intentId: `selection:${seq}`, sequence: seq, type });
    this.#selectionAuthorityGate.register(intent);
    const result = this.#commitGate.propose({
      intent,
      storeKey: StoreKey.SELECTION,
      domain: Domain.SELECTION,
      snapshot,
      context: { ...context, transitionType: type },
    });
    if (result.accepted) this.#metrics.accepted += 1;
    else this.#metrics.rejected += 1;
    return { ...result, snapshot: this.snapshot };
  }

  #reject(type, context, reason) {
    this.#metrics.rejected += 1;
    this.#logger?.emit({
      type: "SELECTION_PROPOSAL_REJECTED",
      transitionType: type,
      reason,
      selectionVersionAtCapture: context?.selectionVersionAtCapture ?? null,
    });
    return { accepted: false, rejectionReason: reason, snapshot: this.snapshot };
  }

  #rejectInvalid(type, context, detail) {
    this.#logger?.emit({
      type: "SELECTION_PROPOSAL_REJECTED",
      transitionType: type,
      reason: CommitRejectionReason.SELECTION_INVALID,
      detail,
    });
    this.#metrics.rejected += 1;
    return { accepted: false, rejectionReason: CommitRejectionReason.SELECTION_INVALID, snapshot: this.snapshot };
  }

  /** Commit a full (nowPlaying/queue/queueIndex) snapshot for the identity-
   * changing transitions that resolve straight to a target index. */
  #commitFullSnapshot(type, queue, index, context, { resetShuffle = true } = {}) {
    const validation = this.#validateContext(context);
    if (!validation.accepted) return this.#reject(type, context, validation.reason);
    const current = this.snapshot;
    return this.#commit(type, this.#buildSnapshot(current, queue, index, resetShuffle ? {
      shuffleOrder: null,
      shufflePosition: 0,
    } : {}), context);
  }
}
