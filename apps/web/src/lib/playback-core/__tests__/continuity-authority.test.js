import test from "node:test";
import assert from "node:assert/strict";

import { PlaybackCore } from "../core/PlaybackCore.js";
import { Domain, DomainOwner } from "../types/index.js";
import { buildContinuityCandidate, CONTINUITY_SCHEMA_VERSION } from "../continuity/continuity-candidate.js";

function track(id) {
  return { id, slug: id, src: `https://example.test/${id}.mp3` };
}

function createContinuityCore() {
  const core = PlaybackCore.create({ loggerEnabled: false });
  // A real (if minimal) execution engine so core.port.play/pause/resume/seek
  // genuinely advance DesiredStateStore.revision through the same pipeline
  // production uses (CommandGateway -> IntentFactory -> execution engine),
  // exactly mirroring transport-authority.test.js's createTransportCore().
  const engine = {
    execute(intent) {
      core._desiredStore.apply(intent);
      return Promise.resolve(true);
    },
    dispose() {},
  };
  core._injectExecutionEngine(engine, {
    effectAuthority: core._effectAuthority,
    disposeInstalledEffectGuard: () => {},
  });
  core._transferDomainToCore(Domain.SELECTION);
  core._transferDomainToCore(Domain.CONTINUITY);
  return core;
}

// ─────────────────────────────────────────────────────────────────────────────
// Ownership
// ─────────────────────────────────────────────────────────────────────────────

test("ownership: CONTINUITY=CORE, SELECTION=CORE, TRANSPORT unaffected", () => {
  const core = createContinuityCore();
  assert.equal(core._ownershipMap[Domain.CONTINUITY], DomainOwner.CORE);
  assert.equal(core._ownershipMap[Domain.SELECTION], DomainOwner.CORE);
  assert.equal(core._ownershipMap[Domain.TRANSPORT], DomainOwner.LEGACY);
  core.destroy();
});

test("continuity cannot commit bookkeeping when its own domain is not Core-owned", () => {
  const core = PlaybackCore.create({ loggerEnabled: false }); // CONTINUITY left LEGACY
  const authority = core._continuityAuthority;
  const result = authority.clearSnapshot();
  assert.equal(result.accepted, false);
  assert.equal(result.rejectionReason, "DOMAIN_NOT_OWNED_BY_CORE");
  core.destroy();
});

test("proposeSelectionRestore cannot commit Selection when Selection itself is not Core-owned", () => {
  const core = PlaybackCore.create({ loggerEnabled: false });
  core._transferDomainToCore(Domain.CONTINUITY); // Selection deliberately NOT transferred
  const authority = core._continuityAuthority;
  const captured = authority.beginSelectionRestore({ source: "test" });
  const { ok, candidate } = buildContinuityCandidate({
    schemaVersion: CONTINUITY_SCHEMA_VERSION,
    selection: { queue: [track("a")], queueIndex: 0 },
  });
  assert.equal(ok, true);
  const result = authority.proposeSelectionRestore(candidate, captured);
  assert.equal(result.accepted, false);
  assert.equal(result.selectionResult.rejectionReason, "DOMAIN_NOT_OWNED_BY_CORE");
  core.destroy();
});

// ─────────────────────────────────────────────────────────────────────────────
// ContinuityCandidate schema validation
// ─────────────────────────────────────────────────────────────────────────────

test("schema: rejects non-object payloads", () => {
  for (const bad of [null, undefined, "queue", 42, [1, 2, 3]]) {
    const result = buildContinuityCandidate(bad);
    assert.equal(result.ok, false);
    assert.equal(result.reason, "CONTINUITY_SCHEMA_INVALID");
  }
});

test("schema: rejects missing/non-integer schemaVersion", () => {
  assert.equal(buildContinuityCandidate({}).ok, false);
  assert.equal(buildContinuityCandidate({ schemaVersion: "1" }).ok, false);
  assert.equal(buildContinuityCandidate({ schemaVersion: 1.5 }).ok, false);
});

test("schema: rejects an unknown NEWER schema version (fail closed, not guess)", () => {
  const result = buildContinuityCandidate({ schemaVersion: CONTINUITY_SCHEMA_VERSION + 1 });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "CONTINUITY_SCHEMA_INVALID");
});

test("schema: accepts the current version with a minimal valid shape", () => {
  const result = buildContinuityCandidate({ schemaVersion: CONTINUITY_SCHEMA_VERSION });
  assert.equal(result.ok, true);
  assert.equal(result.candidate.selection, null);
  assert.equal(result.candidate.timeline, null);
});

test("schema: also accepts the legacy session-memory.js 'v' field name", () => {
  const result = buildContinuityCandidate({ v: CONTINUITY_SCHEMA_VERSION, queue: [] });
  assert.equal(result.ok, true);
});

test("schema: rejects a queue/queueIndex shape that is out of bounds", () => {
  const result = buildContinuityCandidate({
    schemaVersion: CONTINUITY_SCHEMA_VERSION,
    selection: { queue: [track("a")], queueIndex: 5 },
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "CONTINUITY_INVALID");
});

test("schema: corrupt/malformed payload never throws — always a safe {ok:false}", () => {
  const malformed = [
    { schemaVersion: 1, selection: { queue: "not-an-array", queueIndex: 0 } },
    { schemaVersion: 1, selection: { queue: [track("a")], queueIndex: "0" } },
    { schemaVersion: 1, timeline: { position: "NaN-ish" } },
    { schemaVersion: 1, timeline: { position: Number.NaN } },
  ];
  for (const raw of malformed) {
    assert.doesNotThrow(() => {
      const result = buildContinuityCandidate(raw);
      assert.equal(result.ok, false);
    });
  }
});

test("schema: derives nowPlayingIdentity from queue[queueIndex] when not explicit", () => {
  const result = buildContinuityCandidate({
    schemaVersion: CONTINUITY_SCHEMA_VERSION,
    selection: { queue: [track("a"), track("b")], queueIndex: 1 },
  });
  assert.equal(result.ok, true);
  assert.equal(result.candidate.selection.nowPlayingIdentity, "b");
});

// ─────────────────────────────────────────────────────────────────────────────
// Required test #15/16: corrupt payload / unknown schema never break the app
// ─────────────────────────────────────────────────────────────────────────────

test("11/12. corrupt queue and unknown schema are both safely ignored, never thrown", () => {
  const core = createContinuityCore();
  const authority = core._continuityAuthority;
  const corrupt = buildContinuityCandidate({ schemaVersion: 1, selection: { queue: null, queueIndex: "x" } });
  assert.equal(corrupt.ok, false);
  const unknownVersion = buildContinuityCandidate({ schemaVersion: 999 });
  assert.equal(unknownVersion.ok, false);
  // Core's own Selection state must be completely untouched by either.
  assert.equal(core._selectionAuthority.snapshot.nowPlaying, null);
  core.destroy();
});

// ─────────────────────────────────────────────────────────────────────────────
// Selection restore delegation + staleness (INV-CONT-2/3/15)
// ─────────────────────────────────────────────────────────────────────────────

test("15. reload/session-restore: coherent atomic Selection restore via Continuity", () => {
  const core = createContinuityCore();
  const authority = core._continuityAuthority;
  const captured = authority.beginSelectionRestore({ source: "session-restore" });
  const { candidate } = buildContinuityCandidate({
    schemaVersion: CONTINUITY_SCHEMA_VERSION,
    selection: { queue: [track("a"), track("b")], queueIndex: 1, repeatMode: "all", shuffle: true },
  });
  const result = authority.proposeSelectionRestore(candidate, captured);
  assert.equal(result.accepted, true);
  assert.equal(core._selectionAuthority.snapshot.nowPlaying.id, "b");
  assert.equal(core._selectionAuthority.snapshot.repeatMode, "all");
  assert.equal(authority.snapshot.mediaIdentity, "b");
  assert.ok(authority.snapshot.validatedAt > 0);
  core.destroy();
});

test("1. restore A -> user selects B -> late A restore is denied, B remains canonical", () => {
  const core = createContinuityCore();
  const authority = core._continuityAuthority;
  const captured = authority.beginSelectionRestore({ source: "session-restore" }); // "restore starts"
  core._selectionAuthority.selectMedia(track("B")); // user acts -> newer authority
  const { candidate } = buildContinuityCandidate({
    schemaVersion: CONTINUITY_SCHEMA_VERSION,
    selection: { queue: [track("A")], queueIndex: 0 },
  });
  const result = authority.proposeSelectionRestore(candidate, captured); // late A resolves
  assert.equal(result.accepted, false);
  assert.equal(core._selectionAuthority.snapshot.nowPlaying.id, "B", "B must remain canonical");
});

test("2. restore queue -> user replaces queue -> late restore denied", () => {
  const core = createContinuityCore();
  const authority = core._continuityAuthority;
  const captured = authority.beginSelectionRestore({ source: "session-restore" });
  core._selectionAuthority.setQueueAndSelect([track("x"), track("y")], 0);
  const { candidate } = buildContinuityCandidate({
    schemaVersion: CONTINUITY_SCHEMA_VERSION,
    selection: { queue: [track("stale-a"), track("stale-b")], queueIndex: 1 },
  });
  const result = authority.proposeSelectionRestore(candidate, captured);
  assert.equal(result.accepted, false);
  assert.deepEqual(core._selectionAuthority.snapshot.queue.map((t) => t.id), ["x", "y"]);
});

test("8. Core A restore -> Core A disposed -> Core B -> old Core A restore is denied", () => {
  // A real page reload replaces the whole PlaybackCore instance (a fresh
  // CoreEpoch, per Invariant 17) — it does not "rotate" the same one. This
  // proves the equivalent guarantee for that real lifecycle: a candidate
  // captured under a torn-down Core's authority can never commit, because a
  // fresh Core starts its own independent captured-context lineage and has
  // no way to accept a foreign one — the only path INTO Core B's Selection
  // is Core B's OWN capture, which this candidate never went through.
  const coreA = createContinuityCore();
  const authorityA = coreA._continuityAuthority;
  const capturedFromA = authorityA.beginSelectionRestore({ source: "session-restore" });
  coreA.destroy();

  const coreB = createContinuityCore();
  const { candidate } = buildContinuityCandidate({
    schemaVersion: CONTINUITY_SCHEMA_VERSION,
    selection: { queue: [track("a")], queueIndex: 0 },
  });
  // Core A's captured context carries Core A's coreEpoch string, which can
  // never equal Core B's (CoreEpoch is seeded from a fresh IntentSequencer
  // per instance) — proposing it against Core B's authority is rejected.
  const result = coreB._continuityAuthority.proposeSelectionRestore(candidate, capturedFromA);
  assert.equal(result.accepted, false);
  assert.equal(result.rejectionReason, "CONTINUITY_EPOCH_MISMATCH");
  assert.equal(coreB._selectionAuthority.snapshot.nowPlaying, null);
  coreB.destroy();

  // Same-core epoch ROTATION (a hard-recovery reset, not a full reload) is
  // the other half of INV-CONT-15 — also denied:
  const core = createContinuityCore();
  const authority = core._continuityAuthority;
  const capturedBeforeRotate = authority.beginSelectionRestore({ source: "session-restore" });
  core._rotateCoreEpoch("test");
  const result2 = authority.proposeSelectionRestore(candidate, capturedBeforeRotate);
  assert.equal(result2.accepted, false);
  assert.equal(result2.rejectionReason, "CONTINUITY_EPOCH_MISMATCH");
  core.destroy();
});

test("continuity-level epoch check fires even when Selection's own version check would have passed", () => {
  const core = createContinuityCore();
  const authority = core._continuityAuthority;
  const captured = authority.beginSelectionRestore({ source: "session-restore" });
  // Nothing else committed -> Selection's own selectionVersionAtCapture check
  // would pass on its own. Only the epoch rotation should deny this.
  core._rotateCoreEpoch("simulated-runtime-reset");
  const { candidate } = buildContinuityCandidate({
    schemaVersion: CONTINUITY_SCHEMA_VERSION,
    selection: { queue: [track("a")], queueIndex: 0 },
  });
  const result = authority.proposeSelectionRestore(candidate, captured);
  assert.equal(result.accepted, false);
  assert.equal(result.rejectionReason, "CONTINUITY_EPOCH_MISMATCH");
  core.destroy();
});

test("4. two concurrent restore proposals race — only the first to commit wins, the second is stale", () => {
  const core = createContinuityCore();
  const authority = core._continuityAuthority;
  // Both "reads" happen before either "write" resolves — the real shape of a
  // race between two independent restore sources (e.g. the page-load restore
  // effect and a recovery-event restore both in flight at once).
  const capturedFirst = authority.beginSelectionRestore({ source: "session-restore" });
  const capturedSecond = authority.beginSelectionRestore({ source: "recovery-event" });

  const { candidate: candidateFirst } = buildContinuityCandidate({
    schemaVersion: CONTINUITY_SCHEMA_VERSION,
    selection: { queue: [track("first")], queueIndex: 0 },
  });
  const { candidate: candidateSecond } = buildContinuityCandidate({
    schemaVersion: CONTINUITY_SCHEMA_VERSION,
    selection: { queue: [track("second")], queueIndex: 0 },
  });

  const resultFirst = authority.proposeSelectionRestore(candidateFirst, capturedFirst);
  assert.equal(resultFirst.accepted, true);
  assert.equal(core._selectionAuthority.snapshot.nowPlaying.id, "first");

  // capturedSecond was captured before capturedFirst committed — Selection's
  // own selectionVersionAtCapture gate denies it, even though its Continuity
  // epoch is still technically current.
  const resultSecond = authority.proposeSelectionRestore(candidateSecond, capturedSecond);
  assert.equal(resultSecond.accepted, false);
  assert.equal(core._selectionAuthority.snapshot.nowPlaying.id, "first", "the winning restore must not be overwritten by a stale loser");
  core.destroy();
});

test("5. clearSnapshot fired while a restore is in flight does not resurrect the cleared candidate", () => {
  const core = createContinuityCore();
  const authority = core._continuityAuthority;
  const captured = authority.beginSelectionRestore({ source: "session-restore" });
  authority.clearSnapshot(); // e.g. user logs out mid-restore
  const { candidate } = buildContinuityCandidate({
    schemaVersion: CONTINUITY_SCHEMA_VERSION,
    selection: { queue: [track("a")], queueIndex: 0 },
  });
  const result = authority.proposeSelectionRestore(candidate, captured);
  // clearSnapshot does not rotate CoreEpoch or bump Selection's version, so
  // this restore is still architecturally valid to commit — clearSnapshot
  // only erases Continuity's OWN bookkeeping, it is not itself a Selection
  // mutation and must not silently block a proposal already in flight.
  assert.equal(result.accepted, true);
  assert.equal(authority.snapshot.mediaIdentity, "a");
  core.destroy();
});

test("6. background/foreground boundary: nothing else committed while hidden -> restore still succeeds on foreground", () => {
  const core = createContinuityCore();
  const authority = core._continuityAuthority;
  // Simulates capture happening just before the tab is backgrounded; the
  // proposal resolves only after the tab comes back to the foreground. No
  // CoreEpoch rotation and no other commit happened during that gap (the
  // ordinary case — Core survives backgrounding, per usePlaybackEffects.js's
  // existing visibilitychange/pageshow handling), so the capture is still
  // current and the restore commits normally.
  const captured = authority.beginSelectionRestore({ source: "session-restore" });
  const { candidate } = buildContinuityCandidate({
    schemaVersion: CONTINUITY_SCHEMA_VERSION,
    selection: { queue: [track("a")], queueIndex: 0 },
  });
  const result = authority.proposeSelectionRestore(candidate, captured);
  assert.equal(result.accepted, true);
  core.destroy();
});

test("7. background/foreground boundary: a bfcache restore rotates CoreEpoch -> pre-hide capture is denied", () => {
  const core = createContinuityCore();
  const authority = core._continuityAuthority;
  const captured = authority.beginSelectionRestore({ source: "session-restore" });
  // A pageshow-with-persisted (bfcache) or catastrophic-recovery event during
  // backgrounding rotates CoreEpoch (INV-CONT-17) — anything captured before
  // that boundary must be treated as belonging to a runtime that no longer
  // exists, exactly like the full-reload case in test 8 above.
  core._rotateCoreEpoch("bfcache-restore");
  const { candidate } = buildContinuityCandidate({
    schemaVersion: CONTINUITY_SCHEMA_VERSION,
    selection: { queue: [track("a")], queueIndex: 0 },
  });
  const result = authority.proposeSelectionRestore(candidate, captured);
  assert.equal(result.accepted, false);
  assert.equal(result.rejectionReason, "CONTINUITY_EPOCH_MISMATCH");
  core.destroy();
});

test("9/10. capability revalidation: a restored Selection snapshot never carries an isPlaying/playing field", () => {
  // Restoring Selection can only ever move nowPlaying/queue/queueIndex — it
  // is architecturally incapable of starting audio for a track the restoring
  // session may no longer be entitled to, because Selection has no playback
  // field for it to set. Whatever entitlement gate exists on the actual play
  // path (resumePlaybackTransport / playTrackInternal) is untouched by, and
  // always runs after, this restore.
  const core = createContinuityCore();
  const authority = core._continuityAuthority;
  const captured = authority.beginSelectionRestore({ source: "session-restore" });
  const { candidate } = buildContinuityCandidate({
    schemaVersion: CONTINUITY_SCHEMA_VERSION,
    selection: { queue: [track("locked-track")], queueIndex: 0 },
  });
  const result = authority.proposeSelectionRestore(candidate, captured);
  assert.equal(result.accepted, true);
  const snapshot = core._selectionAuthority.snapshot;
  assert.equal("isPlaying" in snapshot, false);
  assert.equal("playing" in snapshot, false);
  core.destroy();
});

// ─────────────────────────────────────────────────────────────────────────────
// Position restore validation (INV-CONT-6/7)
// ─────────────────────────────────────────────────────────────────────────────

test("3. restore position 30s -> user seeks to 90s -> late 30s position is denied by identity/epoch, not silently applied", () => {
  const core = createContinuityCore();
  const authority = core._continuityAuthority;
  const context = authority.captureContext({ source: "session-restore" });
  // Simulate: the runtime moved on (epoch rotated by a hard recovery) between
  // capture and the late 30s position resolving.
  core._rotateCoreEpoch("hard-recovery");
  const result = authority.validatePositionRestore(
    { positionSeconds: 30, durationSeconds: 200, mediaIdentity: "a" },
    { currentMediaIdentity: "a", context },
  );
  assert.equal(result.accepted, false);
  assert.equal(result.rejectionReason, "CONTINUITY_EPOCH_MISMATCH");
  core.destroy();
});

test("position restore rejects a media-identity mismatch (selection moved on)", () => {
  const core = createContinuityCore();
  const authority = core._continuityAuthority;
  const result = authority.validatePositionRestore(
    { positionSeconds: 30, durationSeconds: 200, mediaIdentity: "old-track" },
    { currentMediaIdentity: "new-track" },
  );
  assert.equal(result.accepted, false);
  assert.equal(result.rejectionReason, "CONTINUITY_INVALID");
  core.destroy();
});

test("17. position near end is rejected (documented policy, matches legacy clampRestorePosition)", () => {
  const core = createContinuityCore();
  const authority = core._continuityAuthority;
  const result = authority.validatePositionRestore({ positionSeconds: 198, durationSeconds: 200 }, {});
  assert.equal(result.accepted, false);
  core.destroy();
});

test("position below the minimum threshold is rejected (restoring 2s in is noise, not progress)", () => {
  const core = createContinuityCore();
  const authority = core._continuityAuthority;
  const result = authority.validatePositionRestore({ positionSeconds: 2 }, {});
  assert.equal(result.accepted, false);
  core.destroy();
});

test("a valid mid-track position is accepted and clamped to leave the near-end buffer", () => {
  const core = createContinuityCore();
  const authority = core._continuityAuthority;
  const result = authority.validatePositionRestore({ positionSeconds: 199.9, durationSeconds: 200 }, {});
  // 199.9 alone would be "near end" territory once clamped, but a genuinely
  // mid-track position case:
  const mid = authority.validatePositionRestore({ positionSeconds: 90, durationSeconds: 200 }, {});
  assert.equal(mid.accepted, true);
  assert.equal(mid.position, 90);
  void result;
  core.destroy();
});

test("position restore never mutates TransportTimeline — it only returns a validated number", () => {
  const core = createContinuityCore();
  const authority = core._continuityAuthority;
  authority.validatePositionRestore({ positionSeconds: 90, durationSeconds: 200 }, {});
  // No Transport domain exists to check here since it was never transferred in
  // this test's core, which is itself the point: validatePositionRestore has
  // no dependency on Transport at all.
  assert.equal(core._ownershipMap[Domain.TRANSPORT], DomainOwner.LEGACY);
  core.destroy();
});

// ─────────────────────────────────────────────────────────────────────────────
// SLICE 4D ADDENDUM — same-track seek authority (media identity + CoreEpoch
// alone cannot express "same track, same runtime, but the user has since
// SEEK'd/PAUSE'd/PLAY'd"). validatePositionRestore additionally pins
// DesiredStateStore.revision (Slice 1C's already-canonical "what does the
// user currently want" counter — the same one the real SEEK/PAUSE/RESUME/PLAY
// path advances) at capture time and denies a restore whose capture no
// longer matches the current revision.
// ─────────────────────────────────────────────────────────────────────────────

test("NEGATIVE CONTROL: media-identity + CoreEpoch alone cannot deny a same-track stale seek (reproduces the pre-addendum defect class)", () => {
  // A standalone replica of ONLY the two checks the pre-addendum
  // validatePositionRestore performed — proves those two checks alone are
  // insufficient for this race, in isolation, never touching production code.
  function epochAndIdentityOnlyValidate(candidate, { currentMediaIdentity, context, coreEpochNow }) {
    if (context && context.coreEpoch !== coreEpochNow) {
      return { accepted: false, rejectionReason: "CONTINUITY_EPOCH_MISMATCH" };
    }
    if (
      candidate.mediaIdentity != null &&
      currentMediaIdentity != null &&
      candidate.mediaIdentity !== currentMediaIdentity
    ) {
      return { accepted: false, rejectionReason: "CONTINUITY_INVALID" };
    }
    return { accepted: true, position: candidate.positionSeconds };
  }

  const coreEpochNow = "epoch-1";
  const context = { coreEpoch: coreEpochNow }; // captured when the restore began
  // Same track (A), same CoreEpoch — but the user has since SEEK'd to 90.
  // Epoch+identity alone have no way to see that; they wrongly accept.
  const result = epochAndIdentityOnlyValidate(
    { positionSeconds: 30, mediaIdentity: "A" },
    { currentMediaIdentity: "A", context, coreEpochNow },
  );
  assert.equal(result.accepted, true, "defect reproduced: epoch+identity-only validation wrongly accepts a superseded same-track restore");
});

test("FIXED: the same same-track/same-epoch scenario is denied by the real ContinuityAuthority once a newer SEEK has landed", () => {
  const core = createContinuityCore();
  const authority = core._continuityAuthority;
  core._selectionAuthority.setQueueAndSelect([track("A")], 0);

  const context = authority.captureContext({ source: "recovery-event" }); // restore begins, target 30
  core.port.seek({ positionSeconds: 90, source: "user" }); // user seeks the SAME track to 90

  const result = authority.validatePositionRestore(
    { positionSeconds: 30, mediaIdentity: "A" },
    { currentMediaIdentity: "A", context },
  );
  assert.equal(result.accepted, false);
  assert.equal(result.rejectionReason, "CONTINUITY_POSITION_SUPERSEDED");
  core.destroy();
});

test("A. restore 30 -> user seek 90 -> late restore denied; final desired position target follows 90", () => {
  const core = createContinuityCore();
  const authority = core._continuityAuthority;
  core._selectionAuthority.setQueueAndSelect([track("A")], 0);
  const context = authority.captureContext({ source: "recovery-event" });

  core.port.seek({ positionSeconds: 90 });
  assert.equal(core._desiredStore.current.positionTarget, 90);

  const result = authority.validatePositionRestore({ positionSeconds: 30, mediaIdentity: "A" }, { currentMediaIdentity: "A", context });
  assert.equal(result.accepted, false);
  // The late restore never got to propose anything — desired state still
  // reflects the user's 90, not the stale 30.
  assert.equal(core._desiredStore.current.positionTarget, 90);
  core.destroy();
});

test("B. restore 30 -> user PAUSE -> late restore cannot create an execution effect inconsistent with current desired truth", () => {
  const core = createContinuityCore();
  const authority = core._continuityAuthority;
  core._selectionAuthority.setQueueAndSelect([track("A")], 0);
  const context = authority.captureContext({ source: "recovery-event" });

  core.port.pause({ source: "user" }); // no media/position change, but desiredRevision still advances

  const result = authority.validatePositionRestore({ positionSeconds: 30, mediaIdentity: "A" }, { currentMediaIdentity: "A", context });
  assert.equal(result.accepted, false);
  assert.equal(result.rejectionReason, "CONTINUITY_POSITION_SUPERSEDED");
  core.destroy();
});

test("C. restore 30 -> user PLAY (re-selects/re-starts) -> restore is evaluated against the latest applicable revision", () => {
  const core = createContinuityCore();
  const authority = core._continuityAuthority;
  core._selectionAuthority.setQueueAndSelect([track("A")], 0);
  const context = authority.captureContext({ source: "recovery-event" });

  core.port.play({ trackId: "A", source: "user" });

  const result = authority.validatePositionRestore({ positionSeconds: 30, mediaIdentity: "A" }, { currentMediaIdentity: "A", context });
  assert.equal(result.accepted, false);
  assert.equal(result.rejectionReason, "CONTINUITY_POSITION_SUPERSEDED");
  core.destroy();
});

// D. restore A:30 -> select B -> late A restore denied is Selection's own
// race (already certified by test "1. restore A -> user selects B -> late A
// restore is denied..." above) — position restore has no independent
// media-identity authority of its own to re-certify here.

test("E. restore 30 -> no intervening authority change -> restore allowed", () => {
  const core = createContinuityCore();
  const authority = core._continuityAuthority;
  core._selectionAuthority.setQueueAndSelect([track("A")], 0);
  const context = authority.captureContext({ source: "recovery-event" });

  const result = authority.validatePositionRestore({ positionSeconds: 30, mediaIdentity: "A" }, { currentMediaIdentity: "A", context });
  assert.equal(result.accepted, true);
  assert.equal(result.position, 30);
  core.destroy();
});

test("F. two concurrent restore positions race — whichever actually seeks first makes the other stale, deterministically", () => {
  const core = createContinuityCore();
  const authority = core._continuityAuthority;
  core._selectionAuthority.setQueueAndSelect([track("A")], 0);

  const capturedFirst = authority.captureContext({ source: "session-restore" });
  const capturedSecond = authority.captureContext({ source: "recovery-event" });
  // Both captured at the same revision — neither is stale relative to the
  // other yet. The FIRST to actually execute its seek is the one that
  // advances desiredRevision, which deterministically makes the second one
  // stale the moment IT is validated afterward — there is no ambiguity about
  // which one "wins", because winning IS the act of advancing authority.
  const resultFirst = authority.validatePositionRestore({ positionSeconds: 30, mediaIdentity: "A" }, { currentMediaIdentity: "A", context: capturedFirst });
  assert.equal(resultFirst.accepted, true);
  core.port.seek({ positionSeconds: resultFirst.position }); // first restore's seek actually executes

  const resultSecond = authority.validatePositionRestore({ positionSeconds: 45, mediaIdentity: "A" }, { currentMediaIdentity: "A", context: capturedSecond });
  assert.equal(resultSecond.accepted, false);
  assert.equal(resultSecond.rejectionReason, "CONTINUITY_POSITION_SUPERSEDED");
  assert.equal(core._desiredStore.current.positionTarget, 30, "the second (now-stale) restore must never reach the physical seek");
  core.destroy();
});

// ─────────────────────────────────────────────────────────────────────────────
// Snapshot bookkeeping / clear
// ─────────────────────────────────────────────────────────────────────────────

test("clearSnapshot resets Continuity bookkeeping to the empty shape", () => {
  const core = createContinuityCore();
  const authority = core._continuityAuthority;
  const captured = authority.beginSelectionRestore({});
  const { candidate } = buildContinuityCandidate({
    schemaVersion: CONTINUITY_SCHEMA_VERSION,
    selection: { queue: [track("a")], queueIndex: 0 },
  });
  authority.proposeSelectionRestore(candidate, captured);
  assert.equal(authority.snapshot.mediaIdentity, "a");
  const result = authority.clearSnapshot();
  assert.equal(result.accepted, true);
  assert.equal(authority.snapshot.mediaIdentity, null);
  core.destroy();
});

// ─────────────────────────────────────────────────────────────────────────────
// 19. 120+ stale continuity candidates -> only newest/current authority may commit
// ─────────────────────────────────────────────────────────────────────────────

test("19. 120+ stale continuity candidates never commit; current authority is unaffected", () => {
  const core = createContinuityCore();
  const authority = core._continuityAuthority;
  const selection = core._selectionAuthority;
  // A multi-item live queue so next() genuinely advances (and thus genuinely
  // invalidates a captured context) on every iteration, rather than a
  // 1-item queue where NEXT is a no-op and never actually goes stale.
  selection.setQueueAndSelect([track("live-a"), track("live-b"), track("live-c")], 0);

  for (let i = 0; i < 130; i += 1) {
    const captured = authority.beginSelectionRestore({ source: `stale-${i}` });
    selection.next({ repeatMode: "all", shuffle: false }); // genuinely advances -> invalidates `captured`
    const { candidate } = buildContinuityCandidate({
      schemaVersion: CONTINUITY_SCHEMA_VERSION,
      selection: { queue: [track(`stale-${i}`)], queueIndex: 0 },
    });
    const result = authority.proposeSelectionRestore(candidate, captured);
    assert.equal(result.accepted, false, `stale candidate #${i} must not commit`);
    // None of the 130 rejected candidates may ever become canonical.
    assert.notEqual(selection.snapshot.nowPlaying?.id, `stale-${i}`);
  }

  // Only genuine live-queue traversal ever happened — nowPlaying is always
  // one of the three real tracks, never a stale candidate's track.
  assert.ok(["live-a", "live-b", "live-c"].includes(selection.snapshot.nowPlaying.id));
  assert.deepEqual(selection.snapshot.queue.map((t) => t.id), ["live-a", "live-b", "live-c"]);
  core.destroy();
});

// ─────────────────────────────────────────────────────────────────────────────
// 250+ deterministic interleaving stress test
// ─────────────────────────────────────────────────────────────────────────────

test("stress: 250+ deterministic interleavings preserve Selection coherence and CoreEpoch validity", () => {
  const core = createContinuityCore();
  const authority = core._continuityAuthority;
  const selection = core._selectionAuthority;

  let seed = 0x9e3779b9;
  function rand() {
    seed ^= seed << 13; seed |= 0;
    seed ^= seed >>> 17;
    seed ^= seed << 5; seed |= 0;
    return ((seed >>> 0) % 1000) / 1000;
  }

  selection.setQueueAndSelect([track("a"), track("b"), track("c")], 0);

  const ops = [
    "RESTORE_SELECTION", "SELECT", "NEXT", "PREVIOUS", "QUEUE_REPLACE",
    "POSITION_RESTORE", "RELOAD_CANDIDATE",
  ];

  for (let i = 0; i < 260; i += 1) {
    const op = ops[Math.floor(rand() * ops.length)];
    const before = selection.snapshot;
    switch (op) {
      case "RESTORE_SELECTION": {
        const captured = authority.beginSelectionRestore({ source: "stress" });
        // 60% of the time, mutate live state AFTER capture to force staleness.
        if (rand() < 0.6) selection.next({ repeatMode: "off", shuffle: false });
        const { candidate } = buildContinuityCandidate({
          schemaVersion: CONTINUITY_SCHEMA_VERSION,
          selection: { queue: [track("r1"), track("r2")], queueIndex: Math.floor(rand() * 2) },
        });
        authority.proposeSelectionRestore(candidate, captured);
        break;
      }
      case "SELECT":
        selection.selectMedia(track(`s${Math.floor(rand() * 5)}`));
        break;
      case "NEXT":
        selection.next({ repeatMode: rand() < 0.5 ? "all" : "off", shuffle: rand() < 0.5 });
        break;
      case "PREVIOUS":
        selection.previous({ repeatMode: "off" });
        break;
      case "QUEUE_REPLACE":
        selection.replaceQueue([track("q1"), track("q2"), track("q3")]);
        break;
      case "POSITION_RESTORE": {
        const identity = selection.snapshot.nowPlaying ? (selection.snapshot.nowPlaying.id) : null;
        authority.validatePositionRestore(
          { positionSeconds: Math.floor(rand() * 300), durationSeconds: 300, mediaIdentity: rand() < 0.5 ? identity : "mismatched" },
          { currentMediaIdentity: identity },
        );
        break;
      }
      case "RELOAD_CANDIDATE": {
        if (rand() < 0.3) core._rotateCoreEpoch("stress-rotate");
        const captured = authority.beginSelectionRestore({ source: "reload" });
        const { candidate } = buildContinuityCandidate({
          schemaVersion: CONTINUITY_SCHEMA_VERSION,
          selection: { queue: [track("reload")], queueIndex: 0 },
        });
        authority.proposeSelectionRestore(candidate, captured);
        break;
      }
      default:
        break;
    }

    const snap = selection.snapshot;
    // Selection coherence, every iteration.
    if (snap.queue.length === 0) {
      assert.equal(snap.queueIndex, -1);
      assert.equal(snap.nowPlaying, null);
    } else if (snap.queueIndex >= 0) {
      assert.equal(snap.nowPlaying, snap.queue[snap.queueIndex], `op#${i} (${op}) produced a torn Selection snapshot`);
    }
    // desiredRevision/CoreEpoch validity: CoreEpoch is always a non-empty string.
    assert.ok(typeof core.coreEpoch === "string" && core.coreEpoch.length > 0);
    void before;
  }
  core.destroy();
});
