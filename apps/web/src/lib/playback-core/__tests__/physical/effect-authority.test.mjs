/**
 * Slice 1D physical-effect authority certification.
 *
 * The fake handler's `commitAudibleEffect` is the closest adapter leaf to the
 * production HTMLMediaElement.play() call. It records preparation separately
 * from the guarded audible commit so final-state convergence cannot hide a
 * transient stale-play defect.
 */

import "./dom-shim.mjs";
import { after, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  installFakeMediaLayer,
  resetRuntimeRefs,
  settleSystem,
  Transport,
} from "./fake-media-layer.mjs";
import { buildWiredCore } from "@/lib/playback-core/production/wireProductionCore";
import { dispatchPlaybackCommand } from "@/lib/playback/command-dispatcher";
import {
  canBecomeAudible,
  playAudioIfNotPaused,
} from "@/lib/audio/audio-element-utils";
import {
  PhysicalEffectAuthorityMode,
  getCurrentPhysicalEffectGuard,
} from "@/lib/audio/physical-effect-authority";

const { runtime } = installFakeMediaLayer();
const A = { id: "track-a", slug: "track-a", title: "Track A" };
const B = { id: "track-b", slug: "track-b", title: "Track B" };

let core = null;

function newCore(loggerEnabled = true) {
  core?.destroy();
  core = buildWiredCore({ loggerEnabled, probe: runtime.probe() });
  return core;
}

async function settle() {
  await settleSystem(core, runtime, { timeoutMs: 4000, quietMs: 60 });
}

function entries(name) {
  return runtime.log.filter((event) => event.h === name);
}

beforeEach(() => {
  core?.destroy();
  core = null;
  runtime.reset();
  resetRuntimeRefs();
});

after(() => { core?.destroy(); });

describe("SLICE-1D/1 — generic leaf failure policy", () => {
  test("unclassified, missing, partial, and throwing guards fail closed", () => {
    assert.equal(canBecomeAudible({}), false, "unclassified path must deny");
    assert.equal(canBecomeAudible({
      effectAuthorityMode: PhysicalEffectAuthorityMode.CORE,
      effectGuardRequired: true,
    }), false, "missing token and predicate must deny");
    assert.equal(canBecomeAudible({
      effectAuthorityMode: PhysicalEffectAuthorityMode.CORE,
      effectGuardRequired: true,
      effectAuthority: { desiredRevision: 1 },
    }), false, "partial installation must deny");
    assert.equal(canBecomeAudible({
      effectAuthorityMode: PhysicalEffectAuthorityMode.CORE,
      effectGuardRequired: true,
      effectAuthority: { desiredRevision: 1 },
      canApplyEffect: () => { throw new Error("synthetic guard failure"); },
    }), false, "guard exception must deny");
    assert.equal(canBecomeAudible({
      effectAuthorityMode: PhysicalEffectAuthorityMode.LEGACY,
    }), false, "a legacy label alone must never bypass the production media leaf");
  });

  test("dispatcher metadata preserves fail-closed mode when the payload loses both guard fields", async () => {
    void dispatchPlaybackCommand(
      "PLAY_TRACK",
      { track: A, options: {} },
      { effectAuthorityMode: PhysicalEffectAuthorityMode.CORE },
    );
    await settleSystem(null, runtime);

    assert.equal(runtime.audibleCommitCount, 0);
    assert.ok(entries("effect_denied").some((event) => event.mediaIdentity === A.id));
    assert.equal(runtime.transport, Transport.PAUSED);
  });

  test("every AbortError retry revalidates authority before another play()", async () => {
    let playCalls = 0;
    let guardCalls = 0;
    const audio = {
      paused: true,
      ended: false,
      readyState: 4,
      networkState: 1,
      currentTime: 0,
      src: "",
      buffered: { length: 0 },
      addEventListener() {},
      removeEventListener() {},
      async play() {
        playCalls += 1;
        const error = new Error("synthetic source-buffer race");
        error.name = "AbortError";
        throw error;
      },
    };

    const result = await playAudioIfNotPaused(audio, true, {
      effectAuthorityMode: PhysicalEffectAuthorityMode.CORE,
      effectGuardRequired: true,
      effectAuthority: { desiredRevision: 1 },
      canApplyEffect: () => {
        guardCalls += 1;
        return guardCalls === 1;
      },
      mediaIdentity: A.id,
    });

    assert.equal(result, null);
    assert.equal(guardCalls, 2, "authority must be checked again for the retry");
    assert.equal(playCalls, 1, "the denied retry must never reach audio.play()");
  });

  test("current-media recovery cannot resurrect playback after authoritative PAUSE", async () => {
    const c = newCore();
    c.port.play({ trackId: A.id, queueEntries: [A], queueIndex: 0 });
    c.port.pause();

    let playCalls = 0;
    const audio = {
      paused: true,
      ended: false,
      async play() {
        playCalls += 1;
        this.paused = false;
      },
    };

    const denied = await playAudioIfNotPaused(audio, true, {
      effectAuthorityMode: PhysicalEffectAuthorityMode.CORE_CURRENT,
      mediaIdentity: A.id,
      state: { currentTrack: A },
      command: "LIFECYCLE_RECOVERY",
    });
    assert.equal(denied, null);
    assert.equal(playCalls, 0, "paused desired truth must deny lifecycle recovery");

    c.port.resume({ source: "lifecycle" });
    const wrongMedia = await playAudioIfNotPaused(audio, true, {
      effectAuthorityMode: PhysicalEffectAuthorityMode.CORE_CURRENT,
      mediaIdentity: B.id,
      state: { currentTrack: B },
      command: "LIFECYCLE_RECOVERY",
    });
    assert.equal(wrongMedia, null);
    assert.equal(playCalls, 0, "current recovery may not switch media identity");

    const allowed = await playAudioIfNotPaused(audio, true, {
      effectAuthorityMode: PhysicalEffectAuthorityMode.CORE_CURRENT,
      mediaIdentity: A.id,
      state: { currentTrack: A },
      command: "LIFECYCLE_RECOVERY",
    });
    assert.equal(allowed, true);
    assert.equal(playCalls, 1, "current PLAYING truth may recover the same media");
  });

  test("destroying Core A cannot uninstall Core B's current-media guard", () => {
    const coreA = buildWiredCore({ loggerEnabled: false, probe: runtime.probe() });
    const coreB = buildWiredCore({ loggerEnabled: false, probe: runtime.probe() });
    assert.equal(getCurrentPhysicalEffectGuard(), coreB._effectAuthority);

    coreA.destroy();
    assert.equal(getCurrentPhysicalEffectGuard(), coreB._effectAuthority);

    coreB.destroy();
    assert.equal(getCurrentPhysicalEffectGuard(), null);
  });
});

describe("SLICE-1D/2 — stale work never commits audibility", () => {
  test("PLAY A → PLAY B denies A and allows only B", async () => {
    const c = newCore();
    runtime.loadLatencyMs = 25;
    c.port.play({ trackId: A.id, queueEntries: [A], queueIndex: 0 });
    c.port.play({ trackId: B.id, queueEntries: [B], queueIndex: 0 });
    await settle();

    assert.ok(entries("effect_denied").some((event) =>
      event.mediaIdentity === A.id && event.desiredRevision === 1));
    assert.ok(entries("effect_allowed").some((event) =>
      event.mediaIdentity === B.id && event.desiredRevision === 2));
    assert.deepEqual(entries("audio_play").map((event) => event.mediaIdentity), [B.id]);
    assert.equal(runtime.mediaIdentity, B.id);
    assert.equal(runtime.transport, Transport.PLAYING);
  });

  test("PLAY A → SEEK 92 denies stale start and allows current RESUME at 92", async () => {
    const c = newCore();
    c.port.play({ trackId: A.id, queueEntries: [A], queueIndex: 0 });
    c.port.seek({ positionSeconds: 92 });
    await settle();

    assert.ok(entries("effect_denied").some((event) => event.desiredRevision === 1));
    assert.ok(entries("effect_allowed").some((event) =>
      event.command === "RESUME" && event.desiredRevision === 2));
    assert.equal(runtime.audibleCommitCount, 1);
    assert.equal(runtime.position, 92);
    assert.equal(runtime.transport, Transport.PLAYING);
  });

  test("preloaded Track X grants no authority to PLAY A after PAUSE", async () => {
    const c = newCore();
    runtime.primeLoaded("track-x", 10, Transport.PLAYING);
    c.port.play({ trackId: A.id, queueEntries: [A], queueIndex: 0 });
    c.port.pause();
    await settle();

    assert.equal(runtime.mediaIdentity, A.id, "A may finish preparation");
    assert.equal(runtime.transport, Transport.PAUSED);
    assert.equal(runtime.audibleCommitCount, 0);
    assert.ok(entries("effect_denied").some((event) => event.mediaIdentity === A.id));
  });

  test("a PAUSE issued exactly before the physical commit denies that commit", async () => {
    const c = newCore();
    runtime.beforeAudibleEffect = () => c.port.pause();
    c.port.play({ trackId: A.id, queueEntries: [A], queueIndex: 0 });
    await settle();

    assert.equal(runtime.audibleCommitCount, 0);
    assert.equal(runtime.transport, Transport.PAUSED);
    assert.ok(entries("effect_denied").some((event) => event.desiredRevision === 1));
  });

  test("PLAY A → PAUSE → PLAY A allows only the new A revision", async () => {
    const c = newCore();
    runtime.loadLatencyMs = 20;
    c.port.play({ trackId: A.id, queueEntries: [A], queueIndex: 0 });
    c.port.pause();
    c.port.play({ trackId: A.id, queueEntries: [A], queueIndex: 0 });
    await settle();

    assert.ok(entries("effect_denied").some((event) => event.desiredRevision === 1));
    assert.ok(entries("effect_allowed").some((event) => event.desiredRevision === 3));
    assert.equal(runtime.audibleCommitCount, 1);
    assert.equal(runtime.transport, Transport.PLAYING);
  });

  test("PLAY A → PLAY B → PLAY A allows only the final selection", async () => {
    const c = newCore();
    runtime.loadLatencyMs = 20;
    c.port.play({ trackId: A.id, queueEntries: [A], queueIndex: 0 });
    c.port.play({ trackId: B.id, queueEntries: [B], queueIndex: 0 });
    c.port.play({ trackId: A.id, queueEntries: [A], queueIndex: 0 });
    await settle();

    assert.equal(runtime.audibleCommitCount, 1);
    assert.deepEqual(entries("audio_play").map((event) => ({
      mediaIdentity: event.mediaIdentity,
      desiredRevision: event.desiredRevision,
    })), [{ mediaIdentity: A.id, desiredRevision: 3 }]);
  });

  test("a lifecycle-style RESUME cannot outlive a newer PAUSE", async () => {
    const c = newCore();
    c.port.play({ trackId: A.id, queueEntries: [A], queueIndex: 0 });
    await settle();
    c.port.pause();
    await settle();
    const audibleBeforeResume = runtime.audibleCommitCount;

    runtime.beforeAudibleEffect = () => c.port.pause({ source: "lifecycle" });
    c.port.resume({ source: "lifecycle" });
    await settle();

    assert.equal(runtime.audibleCommitCount, audibleBeforeResume);
    assert.equal(runtime.transport, Transport.PAUSED);
    assert.ok(entries("effect_denied").some((event) => event.command === "RESUME"));
  });
});
