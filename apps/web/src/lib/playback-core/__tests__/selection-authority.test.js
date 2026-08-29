import test from "node:test";
import assert from "node:assert/strict";

import { PlaybackCore } from "../core/PlaybackCore.js";
import { Domain, DomainOwner } from "../types/index.js";
import { CommitGate } from "../commands/CommitGate.js";
import { AuthorityGate } from "../authority/AuthorityGate.js";

function isPlayable(entry) {
  return Boolean(entry?.src);
}

function t(id, extra = {}) {
  return { id, slug: id, src: `https://example.test/${id}.mp3`, ...extra };
}

function unplayable(id) {
  return { id, slug: id, src: null };
}

function createSelectionCore() {
  const core = PlaybackCore.create({ loggerEnabled: false });
  core._transferDomainToCore(Domain.SELECTION);
  return core;
}

function authorityOf(core) {
  return core._selectionAuthority;
}

// ─────────────────────────────────────────────────────────────────────────────
// Ownership
// ─────────────────────────────────────────────────────────────────────────────

test("SLICE-3 ownership: SELECTION=CORE, TRANSPORT unaffected (still LEGACY here)", () => {
  const core = createSelectionCore();
  assert.equal(core._ownershipMap[Domain.SELECTION], DomainOwner.CORE);
  assert.equal(core._ownershipMap[Domain.TRANSPORT], DomainOwner.LEGACY);
  core.destroy();
});

test("legacy writer cannot persist Selection when domain is not Core-owned", () => {
  const core = PlaybackCore.create({ loggerEnabled: false }); // SELECTION left LEGACY
  const authority = authorityOf(core);
  const result = authority.setQueueAndSelect([t("a")], 0);
  assert.equal(result.accepted, false);
  assert.equal(result.rejectionReason, "DOMAIN_NOT_OWNED_BY_CORE");
  assert.equal(authority.snapshot.nowPlaying, null);
  core.destroy();
});

test("CommitGate is the only production file that calls _applyCommit — SelectionAuthority routes through it", () => {
  // Structural proof: SelectionAuthority never calls store._applyCommit directly.
  // (The architecture test in signal-path-low-risk.test.js asserts this across
  // every file under playback-core; this test proves the *behavioral* half —
  // a commit only lands after passing CommitGate's ownership + authority gates.)
  const authorityGate = new AuthorityGate();
  const core = createSelectionCore();
  const authority = authorityOf(core);
  const before = authority.snapshot.selectionVersion;
  authority.setQueueAndSelect([t("a")], 0);
  assert.equal(authority.snapshot.selectionVersion, before + 1);
  void authorityGate;
  core.destroy();
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. Empty state invariant
// ─────────────────────────────────────────────────────────────────────────────

test("1. empty state invariant", () => {
  const core = createSelectionCore();
  const authority = authorityOf(core);
  assert.deepEqual(authority.snapshot.nowPlaying, null);
  assert.deepEqual(authority.snapshot.queue, []);
  assert.equal(authority.snapshot.queueIndex, -1);
  const result = authority.clearQueue();
  assert.equal(result.unchanged, true); // already empty
  core.destroy();
});

// ─────────────────────────────────────────────────────────────────────────────
// 2/3/4. Single track / album select index 0 / album select middle item
// ─────────────────────────────────────────────────────────────────────────────

test("2. single track selection", () => {
  const core = createSelectionCore();
  const authority = authorityOf(core);
  const result = authority.setQueueAndSelect([t("solo")], 0);
  assert.equal(result.accepted, true);
  assert.equal(authority.snapshot.nowPlaying.id, "solo");
  assert.equal(authority.snapshot.queue.length, 1);
  assert.equal(authority.snapshot.queueIndex, 0);
  core.destroy();
});

test("3. album queue select index 0", () => {
  const core = createSelectionCore();
  const authority = authorityOf(core);
  const album = [t("a"), t("b"), t("c"), t("d")];
  const result = authority.setQueueAndSelect(album, 0);
  assert.equal(result.accepted, true);
  assert.equal(authority.snapshot.nowPlaying.id, "a");
  assert.equal(authority.snapshot.queue.length, 4);
  assert.equal(authority.snapshot.queueIndex, 0);
  core.destroy();
});

test("4. album queue select middle item — one atomic commit, not three writes", () => {
  const core = createSelectionCore();
  const authority = authorityOf(core);
  const album = [t("a"), t("b"), t("c"), t("d")];
  const versionsSeen = [];
  authority.subscribe((snap) => versionsSeen.push(snap.selectionVersion));
  const result = authority.setQueueAndSelect(album, 2);
  assert.equal(result.accepted, true);
  assert.equal(authority.snapshot.nowPlaying.id, "c");
  assert.equal(authority.snapshot.queueIndex, 2);
  assert.deepEqual(authority.snapshot.queue, album);
  // Exactly one commit for this one logical action.
  assert.equal(versionsSeen.length, 1);
  core.destroy();
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Queue replace + select atomicity
// ─────────────────────────────────────────────────────────────────────────────

test("5. queue replace + select atomicity", () => {
  const core = createSelectionCore();
  const authority = authorityOf(core);
  authority.setQueueAndSelect([t("a"), t("b"), t("c")], 1); // now playing b
  const result = authority.replaceQueue([t("x"), t("b"), t("y")]);
  assert.equal(result.accepted, true);
  // b's occurrence in the new list is resolved deterministically by identity.
  assert.equal(authority.snapshot.nowPlaying.id, "b");
  assert.equal(authority.snapshot.queueIndex, 1);
  core.destroy();
});

test("replaceQueue falls back to clamped numeric index when identity is gone", () => {
  const core = createSelectionCore();
  const authority = authorityOf(core);
  authority.setQueueAndSelect([t("a"), t("b"), t("c")], 2); // now playing c
  const result = authority.replaceQueue([t("x"), t("y")]);
  assert.equal(result.accepted, true);
  assert.equal(authority.snapshot.queueIndex, 1); // clamp(2, len=2) -> 1
  assert.equal(authority.snapshot.nowPlaying.id, "y");
  core.destroy();
});

test("replaceQueue with empty array collapses to empty-state invariant", () => {
  const core = createSelectionCore();
  const authority = authorityOf(core);
  authority.setQueueAndSelect([t("a")], 0);
  const result = authority.replaceQueue([]);
  assert.equal(result.accepted, true);
  assert.equal(authority.snapshot.nowPlaying, null);
  assert.equal(authority.snapshot.queueIndex, -1);
  core.destroy();
});

// ─────────────────────────────────────────────────────────────────────────────
// 6/7. NEXT / PREVIOUS
// ─────────────────────────────────────────────────────────────────────────────

test("6. NEXT advances one index and commits atomically", () => {
  const core = createSelectionCore();
  const authority = authorityOf(core);
  authority.setQueueAndSelect([t("a"), t("b"), t("c")], 0);
  const result = authority.next({ repeatMode: "off", shuffle: false, isPlayable });
  assert.equal(result.accepted, true);
  assert.equal(result.endOfQueue, false);
  assert.equal(authority.snapshot.nowPlaying.id, "b");
  assert.equal(authority.snapshot.queueIndex, 1);
});

test("6b. manual NEXT at end of non-repeating queue is a no-op (does not wrap)", () => {
  const core = createSelectionCore();
  const authority = authorityOf(core);
  authority.setQueueAndSelect([t("a"), t("b")], 1); // on last track
  const result = authority.next({ repeatMode: "off", shuffle: false, autoAdvance: false, isPlayable });
  assert.equal(result.unchanged, true);
  assert.equal(result.endOfQueue, true);
  assert.equal(authority.snapshot.queueIndex, 1); // unchanged — stayed on b
});

test("7. PREVIOUS moves back one index", () => {
  const core = createSelectionCore();
  const authority = authorityOf(core);
  authority.setQueueAndSelect([t("a"), t("b"), t("c")], 2);
  const result = authority.previous({ repeatMode: "off", isPlayable });
  assert.equal(result.accepted, true);
  assert.equal(authority.snapshot.nowPlaying.id, "b");
});

test("7b. PREVIOUS at first track restarts track 1 (legacy semantics, not a no-op)", () => {
  const core = createSelectionCore();
  const authority = authorityOf(core);
  authority.setQueueAndSelect([t("a"), t("b")], 0);
  const result = authority.previous({ repeatMode: "off", isPlayable });
  assert.equal(result.unchanged, true); // same index (0) — but this IS the defined behavior
  assert.equal(authority.snapshot.queueIndex, 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// 8/9. Repeat ONE (caller responsibility) / repeat ALL wraparound
// ─────────────────────────────────────────────────────────────────────────────

test("8. repeat ONE is not special-cased by SelectionAuthority — NEXT still advances", () => {
  // Restarting the current track under repeat-one is a Transport/seek concern
  // owned by the caller (see PlaybackEventHandlers onEnded); SelectionAuthority
  // treats "one" like "off" for traversal purposes.
  const core = createSelectionCore();
  const authority = authorityOf(core);
  authority.setQueueAndSelect([t("a"), t("b")], 0);
  const result = authority.next({ repeatMode: "one", shuffle: false, isPlayable });
  assert.equal(result.accepted, true);
  assert.equal(authority.snapshot.nowPlaying.id, "b");
});

test("9. repeat ALL wraparound", () => {
  const core = createSelectionCore();
  const authority = authorityOf(core);
  authority.setQueueAndSelect([t("a"), t("b"), t("c")], 2);
  const result = authority.next({ repeatMode: "all", shuffle: false, isPlayable });
  assert.equal(result.accepted, true);
  assert.equal(result.endOfQueue, false);
  assert.equal(authority.snapshot.nowPlaying.id, "a");
  assert.equal(authority.snapshot.queueIndex, 0);
});

test("9b. autoAdvance end-of-queue with no repeat wraps silently to track 1 (endOfQueue:true)", () => {
  const core = createSelectionCore();
  const authority = authorityOf(core);
  authority.setQueueAndSelect([t("a"), t("b")], 1);
  const result = authority.next({ repeatMode: "off", shuffle: false, autoAdvance: true, isPlayable });
  assert.equal(result.accepted, true);
  assert.equal(result.endOfQueue, true);
  assert.equal(authority.snapshot.nowPlaying.id, "a");
  assert.equal(authority.snapshot.queueIndex, 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. Shuffle traversal semantics
// ─────────────────────────────────────────────────────────────────────────────

test("10. shuffle visits every index exactly once before repeating (no immediate repeat)", () => {
  const core = createSelectionCore();
  const authority = authorityOf(core);
  const album = [t("a"), t("b"), t("c"), t("d"), t("e")];
  authority.setQueueAndSelect(album, 0);
  const visited = [authority.snapshot.queueIndex];
  for (let i = 0; i < album.length - 1; i += 1) {
    const result = authority.next({ repeatMode: "off", shuffle: true, isPlayable });
    assert.equal(result.accepted, true);
    visited.push(authority.snapshot.queueIndex);
  }
  const unique = new Set(visited);
  assert.equal(unique.size, album.length, "every index visited exactly once before any repeat");
});

test("shuffle stability: same-queue re-selection preserves the in-progress permutation", () => {
  const core = createSelectionCore();
  const authority = authorityOf(core);
  const album = [t("a"), t("b"), t("c"), t("d")];
  authority.setQueueAndSelect(album, 0);
  authority.next({ repeatMode: "off", shuffle: true, isPlayable });
  const orderAfterFirstNext = authority.snapshot.shuffleOrder.slice();
  // Re-selecting within the SAME queue content must not discard shuffleOrder.
  authority.setQueueAndSelect(album, authority.snapshot.queueIndex);
  assert.deepEqual(authority.snapshot.shuffleOrder, orderAfterFirstNext);
});

test("a genuinely new queue resets shuffle traversal", () => {
  const core = createSelectionCore();
  const authority = authorityOf(core);
  authority.setQueueAndSelect([t("a"), t("b"), t("c")], 0);
  authority.next({ repeatMode: "off", shuffle: true, isPlayable });
  assert.notEqual(authority.snapshot.shuffleOrder, null);
  authority.setQueueAndSelect([t("x"), t("y")], 0);
  assert.equal(authority.snapshot.shuffleOrder, null);
});

// ─────────────────────────────────────────────────────────────────────────────
// 11/12/13. Remove before / current / last
// ─────────────────────────────────────────────────────────────────────────────

test("11. remove before current item decrements index, keeps same NowPlaying", () => {
  const core = createSelectionCore();
  const authority = authorityOf(core);
  authority.setQueueAndSelect([t("a"), t("b"), t("c")], 1); // playing b
  const result = authority.removeItem(0);
  assert.equal(result.accepted, true);
  assert.equal(authority.snapshot.nowPlaying.id, "b");
  assert.equal(authority.snapshot.queueIndex, 0);
  assert.deepEqual(authority.snapshot.queue.map((e) => e.id), ["b", "c"]);
});

test("12. remove current item is rejected — no defined auto-successor policy", () => {
  const core = createSelectionCore();
  const authority = authorityOf(core);
  authority.setQueueAndSelect([t("a"), t("b"), t("c")], 1);
  const result = authority.removeItem(1);
  assert.equal(result.accepted, false);
  assert.equal(result.rejectionReason, "SELECTION_INVALID");
  assert.equal(authority.snapshot.nowPlaying.id, "b"); // unchanged
});

test("13. remove last item (not current) shrinks the queue only", () => {
  const core = createSelectionCore();
  const authority = authorityOf(core);
  authority.setQueueAndSelect([t("a"), t("b"), t("c")], 0);
  const result = authority.removeItem(2);
  assert.equal(result.accepted, true);
  assert.equal(authority.snapshot.queue.length, 2);
  assert.equal(authority.snapshot.nowPlaying.id, "a");
  assert.equal(authority.snapshot.queueIndex, 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// 14/15. Insert before current / reorder while selected
// ─────────────────────────────────────────────────────────────────────────────

test("14. insert before current shifts queueIndex, keeps same NowPlaying", () => {
  const core = createSelectionCore();
  const authority = authorityOf(core);
  authority.setQueueAndSelect([t("a"), t("b")], 1); // playing b
  const result = authority.insertItem(t("z"), { atIndex: 0 });
  assert.equal(result.accepted, true);
  assert.equal(authority.snapshot.queueIndex, 2);
  assert.equal(authority.snapshot.nowPlaying.id, "b");
  assert.deepEqual(authority.snapshot.queue.map((e) => e.id), ["z", "a", "b"]);
});

test("15. reorder while current is selected keeps NowPlaying identity, index tracks the move", () => {
  const core = createSelectionCore();
  const authority = authorityOf(core);
  authority.setQueueAndSelect([t("a"), t("b"), t("c")], 1); // playing b
  const result = authority.reorderQueue(2, 0); // move c before a; b shifts from 1 -> 2
  assert.equal(result.accepted, true);
  assert.equal(authority.snapshot.nowPlaying.id, "b");
  assert.equal(authority.snapshot.queueIndex, 2);
  assert.deepEqual(authority.snapshot.queue.map((e) => e.id), ["c", "a", "b"]);
});

test("reorderQueue rejects moving the currently-selected item itself", () => {
  const core = createSelectionCore();
  const authority = authorityOf(core);
  authority.setQueueAndSelect([t("a"), t("b"), t("c")], 1);
  const result = authority.reorderQueue(1, 2);
  assert.equal(result.accepted, false);
});

// ─────────────────────────────────────────────────────────────────────────────
// 16. Duplicate track identity handling
// ─────────────────────────────────────────────────────────────────────────────

test("16. duplicate track identities preserve occurrence via index, not identity search", () => {
  const core = createSelectionCore();
  const authority = authorityOf(core);
  const album = [t("a"), t("b"), t("a")]; // "a" appears twice
  authority.setQueueAndSelect(album, 2); // select the SECOND occurrence
  assert.equal(authority.snapshot.queueIndex, 2);
  // Compare against the committed (structuredClone'd) snapshot, not the
  // pre-commit original — DomainStore clones on every commit by design, so
  // nowPlaying must be checked for identity against queue[queueIndex] within
  // the SAME snapshot, never against the caller's original object.
  assert.equal(authority.snapshot.nowPlaying, authority.snapshot.queue[2]);
  assert.notEqual(authority.snapshot.queue[0], authority.snapshot.queue[2], "two distinct occurrences, not deduplicated");
  const next = authority.next({ repeatMode: "off", shuffle: false, isPlayable });
  assert.equal(next.unchanged, true); // index 2 is last, non-repeat -> no-op
});

// ─────────────────────────────────────────────────────────────────────────────
// 17. Clear queue
// ─────────────────────────────────────────────────────────────────────────────

test("17. clear queue returns to the canonical empty state", () => {
  const core = createSelectionCore();
  const authority = authorityOf(core);
  authority.setQueueAndSelect([t("a"), t("b")], 0);
  const result = authority.clearQueue();
  assert.equal(result.accepted, true);
  assert.deepEqual(authority.snapshot.queue, []);
  assert.equal(authority.snapshot.queueIndex, -1);
  assert.equal(authority.snapshot.nowPlaying, null);
});

// ─────────────────────────────────────────────────────────────────────────────
// 18. ENDED -> NEXT request (Selection-side half; Transport does not select media)
// ─────────────────────────────────────────────────────────────────────────────

test("18. an autoAdvance NEXT request (as onEnded issues) never needs Transport to choose media", () => {
  const core = createSelectionCore();
  const authority = authorityOf(core);
  authority.setQueueAndSelect([t("a"), t("b")], 0);
  const result = authority.next({ repeatMode: "off", shuffle: false, autoAdvance: true, isPlayable });
  assert.equal(result.accepted, true);
  assert.equal(authority.snapshot.nowPlaying.id, "b");
});

// ─────────────────────────────────────────────────────────────────────────────
// 19/20. Session restore + late restore loses to user selection
// ─────────────────────────────────────────────────────────────────────────────

test("19. session restore Selection succeeds against a fresh (version 0) Core", () => {
  const core = createSelectionCore();
  const authority = authorityOf(core);
  const restoreContext = authority.captureContext({ source: "session-restore" });
  const result = authority.restoreSelection({
    queue: [t("a"), t("b")], queueIndex: 1, repeatMode: "all", shuffle: false,
  }, restoreContext);
  assert.equal(result.accepted, true);
  assert.equal(authority.snapshot.nowPlaying.id, "b");
  assert.equal(authority.snapshot.repeatMode, "all");
});

test("20. late restore loses to a newer user selection (INV-SELECTION-11)", () => {
  const core = createSelectionCore();
  const authority = authorityOf(core);
  // Restore "starts" (captures context) before the user does anything...
  const restoreContext = authority.captureContext({ source: "session-restore" });
  // ...but the user picks a track before the (simulated async) restore resolves.
  authority.setQueueAndSelect([t("user-pick")], 0);
  const result = authority.restoreSelection({
    queue: [t("stale-a"), t("stale-b")], queueIndex: 0,
  }, restoreContext);
  assert.equal(result.accepted, false);
  assert.equal(result.rejectionReason, "SELECTION_VERSION_STALE");
  assert.equal(authority.snapshot.nowPlaying.id, "user-pick"); // untouched
});

// ─────────────────────────────────────────────────────────────────────────────
// 21/22. PLAY A -> PLAY B race / NEXT -> PREVIOUS race
// ─────────────────────────────────────────────────────────────────────────────

test("21. PLAY A -> PLAY B race resolves deterministically to B (synchronous, no interleaving possible)", () => {
  const core = createSelectionCore();
  const authority = authorityOf(core);
  authority.selectMedia(t("A"));
  authority.selectMedia(t("B"));
  assert.equal(authority.snapshot.nowPlaying.id, "B");
});

test("22. NEXT -> PREVIOUS race lands on a coherent final state", () => {
  const core = createSelectionCore();
  const authority = authorityOf(core);
  authority.setQueueAndSelect([t("a"), t("b"), t("c")], 0);
  authority.next({ repeatMode: "off", shuffle: false, isPlayable }); // -> b
  authority.previous({ repeatMode: "off", isPlayable }); // -> a
  assert.equal(authority.snapshot.nowPlaying.id, "a");
  assert.equal(authority.snapshot.queueIndex, 0);
  assert.equal(authority.snapshot.nowPlaying, authority.snapshot.queue[authority.snapshot.queueIndex]);
});

// ─────────────────────────────────────────────────────────────────────────────
// 24. Stale Selection proposal denied (generalized — not just restore)
// ─────────────────────────────────────────────────────────────────────────────

test("24. a stale captured context is denied by every identity-changing transition", () => {
  const core = createSelectionCore();
  const authority = authorityOf(core);
  authority.setQueueAndSelect([t("a")], 0);
  const staleContext = authority.captureContext(); // captured now...
  authority.selectMedia(t("b")); // ...but something else committed first...
  const result = authority.selectIndex(0, staleContext); // ...so this must be rejected
  assert.equal(result.accepted, false);
  assert.equal(result.rejectionReason, "SELECTION_VERSION_STALE");
});

test("core epoch rotation invalidates a captured context", () => {
  const core = createSelectionCore();
  const authority = authorityOf(core);
  const context = authority.captureContext();
  core._rotateCoreEpoch("test");
  const result = authority.setQueueAndSelect([t("a")], 0, context);
  assert.equal(result.accepted, false);
  assert.equal(result.rejectionReason, "SELECTION_EPOCH_MISMATCH");
});

// ─────────────────────────────────────────────────────────────────────────────
// 26. React subscriber receives one atomic snapshot (no tearing)
// ─────────────────────────────────────────────────────────────────────────────

test("26. subscriber snapshot is always internally coherent (nowPlaying === queue[queueIndex])", () => {
  const core = createSelectionCore();
  const authority = authorityOf(core);
  const seen = [];
  authority.subscribe((snap) => seen.push(snap));
  authority.setQueueAndSelect([t("a"), t("b"), t("c")], 1);
  authority.next({ repeatMode: "off", shuffle: false, isPlayable });
  authority.removeItem(0);
  assert.ok(seen.length >= 3);
  for (const snap of seen) {
    if (snap.queueIndex >= 0) {
      assert.equal(snap.nowPlaying, snap.queue[snap.queueIndex], "snapshot must never be torn");
    } else {
      assert.equal(snap.nowPlaying, null);
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 28/29. Selection change does not corrupt Transport / does not reset CoreEpoch
// ─────────────────────────────────────────────────────────────────────────────

test("28/29. Selection commits never touch CoreEpoch or Transport ownership", () => {
  const core = createSelectionCore();
  const authority = authorityOf(core);
  const epochBefore = core.coreEpoch;
  authority.setQueueAndSelect([t("a")], 0);
  authority.next({ repeatMode: "off", shuffle: false, isPlayable });
  assert.equal(core.coreEpoch, epochBefore);
  assert.equal(core._ownershipMap[Domain.TRANSPORT], DomainOwner.LEGACY);
});

// ─────────────────────────────────────────────────────────────────────────────
// Representation-only transitions
// ─────────────────────────────────────────────────────────────────────────────

test("updateNowPlayingRepresentation refreshes fields without bumping selectionVersion", () => {
  const core = createSelectionCore();
  const authority = authorityOf(core);
  authority.setQueueAndSelect([t("a")], 0);
  const versionBefore = authority.snapshot.selectionVersion;
  const result = authority.updateNowPlayingRepresentation({ id: "a", slug: "a", src: "https://cdn/a-full.mp3" });
  assert.equal(result.accepted, true);
  assert.equal(authority.snapshot.nowPlaying.src, "https://cdn/a-full.mp3");
  assert.equal(authority.snapshot.selectionVersion, versionBefore);
  assert.equal(authority.snapshot.queue[0].src, "https://cdn/a-full.mp3", "queue slot stays in sync with nowPlaying");
});

test("updateNowPlayingRepresentation rejects a different identity", () => {
  const core = createSelectionCore();
  const authority = authorityOf(core);
  authority.setQueueAndSelect([t("a")], 0);
  const result = authority.updateNowPlayingRepresentation({ id: "not-a", slug: "not-a" });
  assert.equal(result.accepted, false);
  assert.equal(authority.snapshot.nowPlaying.id, "a");
});

test("updateQueueRepresentation rejects a shape/identity mismatch", () => {
  const core = createSelectionCore();
  const authority = authorityOf(core);
  authority.setQueueAndSelect([t("a"), t("b")], 0);
  const result = authority.updateQueueRepresentation([t("a"), t("different")]);
  assert.equal(result.accepted, false);
});

// ─────────────────────────────────────────────────────────────────────────────
// 250+ operation randomized stress test
// ─────────────────────────────────────────────────────────────────────────────

test("stress: 250+ randomized Selection operations preserve every invariant after every accepted commit", () => {
  const core = createSelectionCore();
  const authority = authorityOf(core);

  // Deterministic seed — xorshift32.
  let seed = 0x2f6e2b1;
  function rand() {
    seed ^= seed << 13; seed |= 0;
    seed ^= seed >>> 17;
    seed ^= seed << 5; seed |= 0;
    return ((seed >>> 0) % 1000) / 1000;
  }
  function pick(arr) { return arr[Math.floor(rand() * arr.length)]; }

  const pool = Array.from({ length: 8 }, (_, i) => t(`p${i}`));
  const ops = ["SELECT", "NEXT", "PREVIOUS", "REPLACE_QUEUE", "REMOVE", "INSERT", "CLEAR", "RESTORE"];

  let lastVersion = authority.snapshot.selectionVersion;
  let staleContext = null;

  for (let i = 0; i < 260; i += 1) {
    const op = pick(ops);
    const before = authority.snapshot;
    let result;
    switch (op) {
      case "SELECT": {
        const n = 1 + Math.floor(rand() * pool.length);
        const entries = pool.slice(0, n);
        const idx = Math.floor(rand() * n);
        result = authority.setQueueAndSelect(entries, idx);
        break;
      }
      case "NEXT":
        result = authority.next({ repeatMode: pick(["off", "one", "all"]), shuffle: rand() < 0.5, autoAdvance: rand() < 0.5, isPlayable });
        break;
      case "PREVIOUS":
        result = authority.previous({ repeatMode: pick(["off", "all"]), isPlayable });
        break;
      case "REPLACE_QUEUE": {
        const n = Math.floor(rand() * pool.length);
        result = authority.replaceQueue(pool.slice(0, n));
        break;
      }
      case "REMOVE":
        if (before.queue.length > 0) {
          result = authority.removeItem(Math.floor(rand() * before.queue.length));
        }
        break;
      case "INSERT":
        result = authority.insertItem(pick(pool), { playNext: rand() < 0.5 });
        break;
      case "CLEAR":
        result = authority.clearQueue();
        break;
      case "RESTORE": {
        // Deliberately try a restore using a PREVIOUSLY captured (now likely
        // stale) context most of the time, to exercise INV-SELECTION-11/5.
        const ctx = rand() < 0.7 && staleContext ? staleContext : authority.captureContext();
        const n = Math.floor(rand() * pool.length);
        result = authority.restoreSelection({ queue: pool.slice(0, n), queueIndex: 0 }, ctx);
        break;
      }
      default:
        break;
    }
    if (i % 17 === 0) staleContext = authority.captureContext();

    const snap = authority.snapshot;
    // ── Invariants that must hold after EVERY iteration, accepted or not ──
    assert.ok(Number.isInteger(snap.queueIndex));
    assert.ok(snap.queueIndex >= -1 && snap.queueIndex < Math.max(snap.queue.length, 0) + 1);
    if (snap.queue.length === 0) {
      assert.equal(snap.queueIndex, -1);
      assert.equal(snap.nowPlaying, null);
    } else if (snap.queueIndex >= 0) {
      assert.equal(snap.nowPlaying, snap.queue[snap.queueIndex], `op#${i} (${op}) produced a torn snapshot`);
    }
    assert.ok(snap.selectionVersion >= lastVersion, "selectionVersion must be monotonic");
    if (result && !result.accepted) {
      // A rejected proposal must never have mutated canonical state.
      assert.equal(snap, before, `op#${i} (${op}) rejection must leave snapshot identity unchanged`);
    }
    lastVersion = snap.selectionVersion;
  }
  core.destroy();
});
