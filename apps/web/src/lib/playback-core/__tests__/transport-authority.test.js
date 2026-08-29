import test from "node:test";
import assert from "node:assert/strict";

import { PlaybackCore } from "../core/PlaybackCore.js";
import {
  Domain,
  DomainOwner,
  TransportObservationType as O,
  TransportStatus as S,
} from "../types/index.js";

function createTransportCore() {
  const core = PlaybackCore.create({ loggerEnabled: false });
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
  core._transferDomainToCore(Domain.TRANSPORT);
  return core;
}

function play(core, trackId = "track-a") {
  core.port.play({ trackId, source: "test" });
  return core._transportAuthority.captureContext({ mediaIdentity: trackId, source: "test" });
}

function physicalPlaying(core, context) {
  core._transportAuthority.observe(O.PHYSICAL_PLAY, {}, context);
  return core._transportAuthority.observe(O.PHYSICAL_PLAYING, {}, context);
}

test("Slice 2 ownership ends TRANSPORT=CORE and SELECTION=LEGACY", () => {
  const core = createTransportCore();
  assert.equal(core._ownershipMap[Domain.TRANSPORT], DomainOwner.CORE);
  assert.equal(core._ownershipMap[Domain.SELECTION], DomainOwner.LEGACY);
  core.destroy();
});

test("PLAY -> physical playing -> canonical PLAYING", () => {
  const core = createTransportCore();
  const context = play(core);
  assert.equal(physicalPlaying(core, context).accepted, true);
  assert.equal(core._transportAuthority.statusSnapshot.status, S.PLAYING);
  core.destroy();
});

test("PLAY -> PAUSE -> late playing cannot leave PAUSED", () => {
  const core = createTransportCore();
  const stalePlay = play(core);
  core.port.pause({ source: "test" });
  const pauseContext = core._transportAuthority.captureContext({ mediaIdentity: "track-a" });
  core._transportAuthority.observe(O.PHYSICAL_PAUSE, {}, pauseContext);
  assert.equal(core._transportAuthority.statusSnapshot.status, S.PAUSED);
  assert.equal(core._transportAuthority.observe(O.PHYSICAL_PLAYING, {}, stalePlay).accepted, false);
  assert.equal(core._transportAuthority.statusSnapshot.status, S.PAUSED);
  core.destroy();
});

test("PLAY -> PAUSE -> PLAY rejects the old pause observation", () => {
  const core = createTransportCore();
  play(core);
  core.port.pause({ source: "test" });
  const stalePause = core._transportAuthority.captureContext({ mediaIdentity: "track-a" });
  const newestPlay = play(core);
  physicalPlaying(core, newestPlay);
  assert.equal(core._transportAuthority.observe(O.PHYSICAL_PAUSE, {}, stalePause).accepted, false);
  assert.equal(core._transportAuthority.statusSnapshot.status, S.PLAYING);
  core.destroy();
});

test("waiting -> PAUSE -> delayed playing cannot commit", () => {
  const core = createTransportCore();
  const playContext = play(core);
  physicalPlaying(core, playContext);
  core._transportAuthority.observe(O.PHYSICAL_WAITING, {}, playContext);
  assert.equal(core._transportAuthority.statusSnapshot.status, S.BUFFERING);
  core.port.pause({ source: "test" });
  const pauseContext = core._transportAuthority.captureContext({ mediaIdentity: "track-a" });
  core._transportAuthority.observe(O.PHYSICAL_PAUSE, {}, pauseContext);
  assert.equal(core._transportAuthority.observe(O.PHYSICAL_PLAYING, {}, playContext).accepted, false);
  assert.equal(core._transportAuthority.statusSnapshot.status, S.PAUSED);
  core.destroy();
});

test("PLAYING -> BUFFERING -> PLAYING", () => {
  const core = createTransportCore();
  const context = play(core);
  physicalPlaying(core, context);
  core._transportAuthority.observe(O.PHYSICAL_STALLED, {}, context);
  assert.equal(core._transportAuthority.statusSnapshot.status, S.BUFFERING);
  core._transportAuthority.observe(O.PHYSICAL_PLAYING, {}, context);
  assert.equal(core._transportAuthority.statusSnapshot.status, S.PLAYING);
  core.destroy();
});

test("committed seek uses SEEKING and resolves from seeked", () => {
  const core = createTransportCore();
  physicalPlaying(core, play(core));
  core.port.seek({ positionSeconds: 42, source: "test" });
  const context = core._transportAuthority.captureContext({ mediaIdentity: "track-a" });
  core._transportAuthority.observe(O.PHYSICAL_SEEKING, {}, context);
  assert.equal(core._transportAuthority.statusSnapshot.status, S.SEEKING);
  core._transportAuthority.observeTimeline({ position: 42, duration: 180 }, context, { force: true });
  core._transportAuthority.observe(O.PHYSICAL_SEEKED, { position: 42, playing: true }, context);
  assert.equal(core._transportAuthority.statusSnapshot.status, S.PLAYING);
  assert.equal(core._transportAuthority.timelineSnapshot.position, 42);
  core.destroy();
});

test("old play promise result after PAUSE has no commit authority", () => {
  const core = createTransportCore();
  const oldCompletion = play(core);
  core.port.pause({ source: "test" });
  const paused = core._transportAuthority.captureContext({ mediaIdentity: "track-a" });
  core._transportAuthority.observe(O.PHYSICAL_PAUSE, {}, paused);
  const result = core._transportAuthority.observe(O.EXECUTION_RESULT, {
    playbackState: "playing",
    physicallyConfirmed: true,
  }, oldCompletion);
  assert.equal(result.accepted, false);
  assert.equal(core._transportAuthority.statusSnapshot.status, S.PAUSED);
  core.destroy();
});

test("old RESUME completion after PAUSE cannot commit PLAYING", () => {
  const core = createTransportCore();
  play(core);
  core.port.pause({ source: "test" });
  core.port.resume({ source: "test" });
  const staleResume = core._transportAuthority.captureContext({ mediaIdentity: "track-a" });
  core.port.pause({ source: "test" });
  const paused = core._transportAuthority.captureContext({ mediaIdentity: "track-a" });
  core._transportAuthority.observe(O.PHYSICAL_PAUSE, {}, paused);
  assert.equal(core._transportAuthority.observe(O.PHYSICAL_PLAYING, {}, staleResume).accepted, false);
  assert.equal(core._transportAuthority.statusSnapshot.status, S.PAUSED);
  core.destroy();
});

test("old recovery completion cannot overwrite a newer PLAY", () => {
  const core = createTransportCore();
  const first = play(core);
  core._transportAuthority.observe(O.PHYSICAL_ERROR, { error: "old" }, first);
  const recovery = core._transportAuthority.captureContext({ mediaIdentity: "track-a" });
  core._transportAuthority.observe(O.RECOVERY_STARTED, {}, recovery);
  const newest = play(core);
  physicalPlaying(core, newest);
  assert.equal(core._transportAuthority.observe(O.RECOVERY_FAILED, { error: "late" }, recovery).accepted, false);
  assert.equal(core._transportAuthority.statusSnapshot.status, S.PLAYING);
  core.destroy();
});

test("ENDED is Transport truth while Selection remains legacy-owned", () => {
  const core = createTransportCore();
  const context = play(core);
  physicalPlaying(core, context);
  core._transportAuthority.observe(O.PHYSICAL_ENDED, { endReason: "natural" }, context);
  assert.equal(core._transportAuthority.statusSnapshot.status, S.ENDED);
  assert.equal(core._ownershipMap[Domain.SELECTION], DomainOwner.LEGACY);
  core.destroy();
});

const PHYSICAL_OBSERVATION_CASES = [
  {
    name: "play",
    type: O.PHYSICAL_PLAY,
    arrange: (core) => ({ context: play(core), payload: {} }),
    expected: S.LOADING,
  },
  {
    name: "playing",
    type: O.PHYSICAL_PLAYING,
    arrange: (core) => ({ context: play(core), payload: {} }),
    expected: S.PLAYING,
  },
  {
    name: "pause",
    type: O.PHYSICAL_PAUSE,
    arrange: (core) => {
      play(core);
      core.port.pause({ source: "physical-matrix" });
      return {
        context: core._transportAuthority.captureContext({ mediaIdentity: "track-a" }),
        payload: {},
      };
    },
    expected: S.PAUSED,
  },
  {
    name: "waiting",
    type: O.PHYSICAL_WAITING,
    arrange: (core) => ({ context: play(core), payload: {} }),
    expected: S.BUFFERING,
  },
  {
    name: "stalled",
    type: O.PHYSICAL_STALLED,
    arrange: (core) => ({ context: play(core), payload: {} }),
    expected: S.BUFFERING,
  },
  {
    name: "seeking",
    type: O.PHYSICAL_SEEKING,
    arrange: (core) => {
      play(core);
      core.port.seek({ positionSeconds: 42, source: "physical-matrix" });
      return {
        context: core._transportAuthority.captureContext({ mediaIdentity: "track-a" }),
        payload: {},
      };
    },
    expected: S.SEEKING,
  },
  {
    name: "seeked",
    type: O.PHYSICAL_SEEKED,
    arrange: (core) => {
      play(core);
      core.port.seek({ positionSeconds: 42, source: "physical-matrix" });
      const context = core._transportAuthority.captureContext({ mediaIdentity: "track-a" });
      core._transportAuthority.observe(O.PHYSICAL_SEEKING, {}, context);
      return { context, payload: { position: 42, playing: true } };
    },
    expected: S.PLAYING,
  },
  {
    name: "ended",
    type: O.PHYSICAL_ENDED,
    arrange: (core) => ({ context: play(core), payload: { endReason: "natural" } }),
    expected: S.ENDED,
  },
  {
    name: "error",
    type: O.PHYSICAL_ERROR,
    arrange: (core) => ({ context: play(core), payload: { error: "synthetic" } }),
    expected: S.ERROR,
  },
];

for (const physicalCase of PHYSICAL_OBSERVATION_CASES) {
  test(`physical ${physicalCase.name} observation commits only with current authority`, () => {
    const validCore = createTransportCore();
    const valid = physicalCase.arrange(validCore);
    const result = validCore._transportAuthority.observe(
      physicalCase.type,
      valid.payload,
      valid.context,
    );
    assert.equal(result.accepted, true);
    assert.equal(validCore._transportAuthority.statusSnapshot.status, physicalCase.expected);
    assert.equal(
      validCore._transportAuthority.statusSnapshot.sourceObservation,
      physicalCase.type,
    );
    validCore.destroy();

    const staleCore = createTransportCore();
    const stale = physicalCase.arrange(staleCore);
    // Advance desired authority without reusing the observation's captured context.
    staleCore.port.pause({ source: "physical-matrix-supersede" });
    const before = staleCore._transportAuthority.statusSnapshot;
    const staleResult = staleCore._transportAuthority.observe(
      physicalCase.type,
      stale.payload,
      stale.context,
    );
    assert.equal(staleResult.accepted, false);
    assert.equal(staleResult.rejectionReason, "DESIRED_REVISION_MISMATCH");
    assert.strictEqual(staleCore._transportAuthority.statusSnapshot, before);
    staleCore.destroy();
  });
}

test("100+ interleaved command contexts permit only the newest observation", () => {
  const core = createTransportCore();
  const contexts = [];
  for (let i = 0; i < 120; i += 1) {
    if (i % 3 === 0) contexts.push(play(core));
    else if (i % 3 === 1) {
      core.port.pause({ source: "stress" });
      contexts.push(core._transportAuthority.captureContext({ mediaIdentity: "track-a" }));
    } else {
      core.port.resume({ source: "stress" });
      contexts.push(core._transportAuthority.captureContext({ mediaIdentity: "track-a" }));
    }
  }
  let accepted = 0;
  for (let i = 0; i < contexts.length; i += 1) {
    const result = core._transportAuthority.observe(
      i === contexts.length - 1 ? O.PHYSICAL_PLAYING : O.EXECUTION_RESULT,
      i === contexts.length - 1 ? {} : { playbackState: "playing", physicallyConfirmed: true },
      contexts[i],
    );
    if (result.accepted) accepted += 1;
  }
  assert.equal(accepted, 1);
  assert.equal(core._transportAuthority.statusSnapshot.status, S.PLAYING);
  core.destroy();
});

test("high-resolution observations publish a throttled presentation timeline", () => {
  const core = createTransportCore();
  const context = play(core);
  const realNow = Date.now;
  let now = 1000;
  Date.now = () => now;
  try {
    for (let i = 0; i < 120; i += 1) {
      core._transportAuthority.observeTimeline({ position: i / 60, duration: 180 }, context);
      now += 16;
    }
    const metrics = core._transportAuthority.metrics;
    assert.equal(metrics.timelineObservations, 120);
    assert.ok(metrics.timelineCommits >= 7 && metrics.timelineCommits <= 9, JSON.stringify(metrics));
    assert.ok(metrics.timelineObservations / metrics.timelineCommits >= 13);
  } finally {
    Date.now = realNow;
    core.destroy();
  }
});
