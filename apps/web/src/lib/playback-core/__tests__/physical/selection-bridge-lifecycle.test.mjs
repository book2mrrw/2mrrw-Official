/**
 * SLICE 3 ADDENDUM — Production Selection wiring / initialization-order
 * certification.
 *
 * Proves the real production module-evaluation order:
 *   PlaybackStateMachine singleton constructed (module import)
 *     -> [time passes, nothing wired yet]
 *     -> production Core wiring happens (inside a React hook body, later)
 *     -> Domain.SELECTION transfers to Core, sink installs
 *     -> PSM's first REAL subscribeContext()/subscribeIdentity() call
 *        establishes the bridge lazily
 *     -> canonical Selection commits propagate atomically from then on.
 *
 * `playbackStateMachine` is imported once, at the top of this file, exactly
 * mirroring production: the singleton exists long before any test body wires
 * a Core. No test in this file may run before construction (impossible, since
 * the import above is what constructs it) or wire a Core before that
 * construction (also impossible — imports resolve first). What this file
 * actually exercises is everything AFTER construction: that no subscription
 * was made eagerly, and that the lazy bridge established on first real
 * subscribe is correct, singular, and durable.
 *
 * Runs under the physical alias-loader (`node --experimental-loader
 * ./alias-loader.mjs`) so `@/...` production imports resolve unmodified.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { PlaybackCore } from "@/lib/playback-core/core/PlaybackCore.js";
import { Domain } from "@/lib/playback-core/types/index.js";
import {
  installSelectionAuthoritySink,
  subscribeCanonicalSelection,
  getCanonicalSelection,
  proposeSelection,
} from "@/lib/playback/selection-port.js";
import { playbackStateMachine } from "@/media/PlaybackStateMachine.js";

function track(id) {
  return { id, slug: id, src: `https://example.test/${id}.mp3` };
}

/** Build a sink object identical in shape to the one wireProductionCore.js
 * installs, wrapping `subscribe` so tests can count real bridge attachments. */
function makeSink(authority, counterRef) {
  return {
    captureContext: (meta) => authority.captureContext(meta),
    propose: (name, args, ctx) => (ctx ? authority[name](...args, ctx) : authority[name](...args)),
    getSnapshot: () => authority.snapshot,
    subscribe: (fn) => {
      if (counterRef) counterRef.count += 1;
      return authority.subscribe(fn);
    },
    getMetrics: () => authority.metrics,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// H. Sink unavailable — must run FIRST, before any test in this process
//    installs a sink into the shared selection-port module state.
// ─────────────────────────────────────────────────────────────────────────────

test("H. Core Selection sink unavailable: no false success, no permanent poisoning", () => {
  const snap = getCanonicalSelection();
  assert.deepEqual(snap.queue, []);
  assert.equal(snap.nowPlaying, null);
  assert.equal(snap.queueIndex, -1);

  let fired = false;
  const unsub = subscribeCanonicalSelection(() => { fired = true; });
  assert.equal(typeof unsub, "function");
  assert.doesNotThrow(() => unsub());
  assert.equal(fired, false);

  const result = proposeSelection("setQueueAndSelect", [[track("a")], 0]);
  assert.equal(result.accepted, false);
  assert.equal(result.rejectionReason, "SELECTION_AUTHORITY_UNAVAILABLE");
  // Fails closed, not open — canonical snapshot is still the safe empty one.
  assert.deepEqual(getCanonicalSelection().queue, []);
});

// ─────────────────────────────────────────────────────────────────────────────
// NEGATIVE CONTROL — reproduces the exact defect class found during Slice 3:
// subscribing before the sink installs binds permanently to "unavailable".
// Uses its own isolated Core instance; disposes before the real tests below
// so it cannot leak into the shared selection-port module state.
// ─────────────────────────────────────────────────────────────────────────────

test("NEGATIVE CONTROL: eager subscription before sink install misses the commit that follows wiring (the original bug class)", () => {
  let received = null;

  // This is the exact shape of the bug an earlier draft of
  // PlaybackStateMachine's constructor had: subscribe now, before Core exists.
  const eagerUnsub = subscribeCanonicalSelection((snap) => { received = snap; });

  // Production wiring happens LATER, as it always does in the real app
  // (inside a React hook body, during AudioProvider's first render).
  const core = PlaybackCore.create({ loggerEnabled: false });
  core._transferDomainToCore(Domain.SELECTION);
  const authority = core._selectionAuthority;
  const dispose = installSelectionAuthoritySink(makeSink(authority));

  try {
    authority.setQueueAndSelect([track("a")], 0);

    // THE DEFECT, reproduced: the eager subscriber was bound to "no sink"
    // at the moment it called subscribeCanonicalSelection() and is
    // permanently disconnected — it never sees this, or any future, commit.
    assert.equal(received, null, "eager-bound subscriber incorrectly received a commit — negative control did not reproduce the defect");
    assert.doesNotThrow(() => eagerUnsub());
  } finally {
    dispose();
    core.destroy();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// REAL PRODUCTION-ORDER LIFECYCLE — the actual PlaybackStateMachine singleton,
// the actual selection-port seam, a freshly wired Core standing in for
// wireProductionCore.js's Selection half (Transport wiring is unrelated to
// this defect class and is exercised elsewhere — see transport-authority
// and physical suites).
// ─────────────────────────────────────────────────────────────────────────────

let core;
let authority;
let disposeSink;
let bridgeCalls = { count: 0 };
let unsubContext;
let contextReceived;

test("A/B/F. PSM constructed before Core wiring; lazy bridge attaches only on first real subscribe, after wiring", () => {
  // `playbackStateMachine` was imported — constructed — at the top of this
  // file, before this test (or any Core wiring) ever ran.
  assert.equal(playbackStateMachine._selectionUnsub, null, "bridge must not exist before any real subscriber has attached");

  core = PlaybackCore.create({ loggerEnabled: false });
  core._transferDomainToCore(Domain.SELECTION);
  authority = core._selectionAuthority;
  disposeSink = installSelectionAuthoritySink(makeSink(authority, bridgeCalls));

  // Sink is installed now, but PSM still has not subscribed — construction
  // and even sink installation are still both prior to (B)'s "first request".
  assert.equal(playbackStateMachine._selectionUnsub, null, "sink installation alone must not establish the bridge");
  assert.equal(bridgeCalls.count, 0);

  contextReceived = [];
  const before = playbackStateMachine.getContextSnapshot();
  assert.equal(before.queue.length, 0);

  // First real subscriber — mirrors AudioProvider's useSyncExternalStore
  // subscribe call, which always happens after AudioProvider's render (and
  // therefore after getProductionPlaybackCore() has already wired Core).
  unsubContext = playbackStateMachine.subscribeContext((snap) => contextReceived.push(snap));

  assert.equal(typeof playbackStateMachine._selectionUnsub, "function", "bridge must now exist");
  assert.equal(bridgeCalls.count, 1, "exactly one live bridge subscription");

  // F. First commit after wiring propagates atomically.
  authority.setQueueAndSelect([track("x"), track("y")], 0);

  assert.equal(contextReceived.length, 1, "the lazily-bridged subscriber must receive the commit");
  const after = playbackStateMachine.getContextSnapshot();
  assert.equal(after.queue.length, 2);
  assert.equal(after.currentTrack.id, "x");
  assert.equal(after.queueIndex, 0);
  assert.equal(after.currentTrack, after.queue[after.queueIndex], "atomic — never a torn read across the three fields");
});

test("C. multiple PSM subscribers share one Core bridge subscription, no duplicates", () => {
  const secondReceived = [];
  const unsubSecond = playbackStateMachine.subscribeContext((snap) => secondReceived.push(snap));
  const identityReceived = [];
  const unsubIdentity = playbackStateMachine.subscribeIdentity((snap) => identityReceived.push(snap));

  assert.equal(bridgeCalls.count, 1, "adding more PSM-level listeners must not install a second Core bridge subscription");

  const result = authority.next({ repeatMode: "off", shuffle: false });
  assert.equal(result.accepted, true);

  assert.ok(contextReceived.length >= 2, "the original subscriber keeps receiving commits");
  assert.ok(secondReceived.length >= 1, "the new subscriber receives this commit too");
  assert.ok(identityReceived.length >= 1, "identity subscribers ride the same bridge");
  assert.equal(bridgeCalls.count, 1, "still exactly one bridge subscription after a real commit");

  unsubSecond();
  unsubIdentity();
});

test("G. repeated Selection commits never leave a stale snapshot", () => {
  const versions = [];
  for (let i = 0; i < 3; i += 1) {
    authority.previous({ repeatMode: "off" });
    authority.next({ repeatMode: "off", shuffle: false });
    const snap = playbackStateMachine.getContextSnapshot();
    versions.push(snap.currentTrack?.id ?? null);
  }
  // Every read reflects whatever the most recent commit actually produced —
  // never a value trailing behind the true canonical state.
  const trueFinal = authority.snapshot.nowPlaying?.id ?? null;
  assert.equal(playbackStateMachine.getContextSnapshot().currentTrack?.id ?? null, trueFinal);
  assert.equal(versions[versions.length - 1], trueFinal);
});

test("D. unsubscribing every PSM listener leaves the bridge subscription intact (documented actual lifecycle)", () => {
  // PSM's bridge is reference-counted at SETUP only (idempotent first-call),
  // not torn down when the listener count returns to zero — a deliberate,
  // documented choice (see _ensureSelectionBridgeSubscribed's own comment):
  // the singleton bridge lives for the tab's session, matching Core's own
  // session-singleton lifetime. This test proves that actual behavior rather
  // than inventing reference-counted teardown that production doesn't have.
  unsubContext();

  assert.equal(typeof playbackStateMachine._selectionUnsub, "function", "the bridge itself persists — it is not listener-reference-counted");

  // A commit with zero PSM listeners attached must not throw or corrupt state.
  assert.doesNotThrow(() => authority.next({ repeatMode: "off", shuffle: false }));
});

test("E. resubscribing (e.g. a remounted component) resumes reactive updates correctly", () => {
  const resumed = [];
  const unsub = playbackStateMachine.subscribeContext((snap) => resumed.push(snap));

  // Still the same one bridge subscription — re-subscribing at the PSM
  // listener level does not touch the underlying Core bridge at all.
  assert.equal(bridgeCalls.count, 1);

  const result = authority.previous({ repeatMode: "off" });
  assert.equal(result.accepted, true);
  assert.equal(resumed.length, 1, "the new subscriber receives the very next commit");

  unsub();
});

test("I. documented lifecycle: PSM's bridge does not rebind if Core were ever replaced mid-session (production never does this — Core is a session singleton)", () => {
  // getProductionPlaybackCore() is an explicit session singleton;
  // resetProductionPlaybackCore() is documented "Intended for HMR and tests
  // only... Production code must never call this." This test characterizes
  // — rather than invents — what would happen if that boundary were crossed,
  // so a future change to that lifecycle cannot silently regress unnoticed.
  const callsBefore = bridgeCalls.count;
  const lastKnownTrackId = playbackStateMachine.getContextSnapshot().currentTrack?.id ?? null;
  disposeSink();
  core.destroy();

  const replacementCore = PlaybackCore.create({ loggerEnabled: false });
  replacementCore._transferDomainToCore(Domain.SELECTION);
  const replacementAuthority = replacementCore._selectionAuthority;
  installSelectionAuthoritySink(makeSink(replacementAuthority, bridgeCalls));

  replacementAuthority.setQueueAndSelect([track("z")], 0);

  // PSM's bridge is guarded by `_selectionUnsub` (already truthy) and never
  // re-subscribes to a replacement Core — this commit is not observed. This
  // is an accepted limitation given Core's real lifecycle, not a defect.
  assert.equal(bridgeCalls.count, callsBefore, "no new bridge subscription is installed against the replacement Core");
  assert.equal(
    playbackStateMachine.getContextSnapshot().currentTrack?.id ?? null,
    lastKnownTrackId,
    "PSM's projection reflects the last commit from the ORIGINAL Core, not the replacement",
  );

  replacementCore.destroy();
});
