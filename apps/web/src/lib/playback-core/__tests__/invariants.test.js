/**
 * 2MRRW Playback Core — Architectural Invariant Tests
 *
 * Run with: node --test apps/web/src/lib/playback-core/__tests__/invariants.test.js
 *
 * These tests verify the locked architectural invariants from the specification.
 * They are NOT integration tests — each component is tested in isolation.
 * No mocks. No Jest. No React. Plain node:test + node:assert/strict.
 *
 * Coverage map:
 *   INV-01  Superseded intent never commits state
 *   INV-02  At most one writer per domain at any instant
 *   INV-03a Deck B handoff gate: authoritative at commit boundary (same as INV-01 via CommitGate)
 *   INV-06  Pull-based clock: DomainStore snapshots are frozen references
 *   INV-10  At most one authoritative intent at any instant
 *   INV-17  sessionEpoch owned exclusively by PlaybackCore lifecycle
 *   INV-OWN All domains start LEGACY; transfer is one-way
 *   INV-SEQ IntentSequencer is monotonically increasing
 *   INV-LOG CoreLogger ring buffer caps at RING_CAPACITY
 *   INV-PORT PlaybackPort public surface is complete and correct
 *   INV-CORE PlaybackCore.create() wires all components
 */

import { describe, test, before } from "node:test";
import assert from "node:assert/strict";

// Relative imports — no @/ alias in node:test
import { IntentSequencer }         from "../intents/IntentSequencer.js";
import { IntentFactory }           from "../intents/IntentFactory.js";
import { AuthorityGate }           from "../authority/AuthorityGate.js";
import { DomainOwnershipRegistry } from "../ownership/DomainOwnershipRegistry.js";
import { DomainStore }             from "../state/DomainStore.js";
import { createDomainStores }      from "../state/createDomainStores.js";
import { CoreLogger }              from "../diagnostics/CoreLogger.js";
import { CommitGate }              from "../commands/CommitGate.js";
import { CommandGateway }          from "../commands/CommandGateway.js";
import { PlaybackPort }            from "../ports/PlaybackPort.js";
import { LegacyPlaybackAdapter }   from "../ports/LegacyPlaybackAdapter.js";
import { PlaybackCore }            from "../core/PlaybackCore.js";
import {
  CoreCommandType,
  ResumePolicy,
  DomainOwner,
  Domain,
  StoreKey,
  CommitRejectionReason,
} from "../types/index.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeGateway({ logger } = {}) {
  const sequencer     = new IntentSequencer();
  const intentFactory = new IntentFactory(sequencer);
  const authorityGate = new AuthorityGate();
  const log           = logger ?? new CoreLogger({ enabled: false });
  const gateway       = new CommandGateway({ intentFactory, authorityGate, logger: log });
  return { sequencer, intentFactory, authorityGate, gateway, logger: log };
}

function makeFullStack() {
  const sequencer         = new IntentSequencer();
  const intentFactory     = new IntentFactory(sequencer);
  const authorityGate     = new AuthorityGate();
  const ownershipRegistry = new DomainOwnershipRegistry();
  const stores            = createDomainStores();
  const logger            = new CoreLogger({ enabled: false });
  const commitGate        = new CommitGate({ authorityGate, ownershipRegistry, stores, logger });
  const commandGateway    = new CommandGateway({ intentFactory, authorityGate, logger });
  const port              = new PlaybackPort(commandGateway);
  const legacyAdapter     = new LegacyPlaybackAdapter({ stores, ownershipRegistry });
  return { sequencer, intentFactory, authorityGate, ownershipRegistry, stores, logger, commitGate, commandGateway, port, legacyAdapter };
}

// ─────────────────────────────────────────────────────────────────────────────
// INV-SEQ: IntentSequencer
// ─────────────────────────────────────────────────────────────────────────────

describe("INV-SEQ: IntentSequencer", () => {
  test("produces monotonically increasing sequence numbers", () => {
    const seq = new IntentSequencer();
    const a = seq.next();
    const b = seq.next();
    const c = seq.next();
    assert.equal(a.sequence, 1);
    assert.equal(b.sequence, 2);
    assert.equal(c.sequence, 3);
    assert.ok(a.sequence < b.sequence);
    assert.ok(b.sequence < c.sequence);
  });

  test("sessionEpoch is an 8-character hex string", () => {
    const seq = new IntentSequencer();
    assert.match(seq.sessionEpoch, /^[0-9a-f]{8}$/);
  });

  test("sessionEpoch is stable across multiple next() calls", () => {
    const seq = new IntentSequencer();
    const epoch = seq.sessionEpoch;
    seq.next(); seq.next(); seq.next();
    assert.equal(seq.sessionEpoch, epoch);
  });

  test("intentId format is <epoch>:<sequence>", () => {
    const seq = new IntentSequencer();
    const { intentId, sequence } = seq.next();
    assert.match(intentId, /^[0-9a-f]{8}:\d+$/);
    assert.equal(intentId, `${seq.sessionEpoch}:${sequence}`);
  });

  test("two sequencers have different epochs (probabilistic)", () => {
    const a = new IntentSequencer();
    const b = new IntentSequencer();
    // Probability of collision is 1/2^32; acceptable for testing
    assert.notEqual(a.sessionEpoch, b.sessionEpoch);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// INV-10: AuthorityGate — at most one authoritative intent at any instant
// ─────────────────────────────────────────────────────────────────────────────

describe("INV-10: AuthorityGate — single authority", () => {
  test("newly registered intent is authoritative", () => {
    const gate = new AuthorityGate();
    const seq  = new IntentSequencer();
    const factory = new IntentFactory(seq);
    const intent = factory.create({ type: CoreCommandType.PLAY });
    gate.register(intent);
    assert.ok(gate.isAuthoritative(intent));
  });

  test("registering a second intent supersedes the first (INV-01 prerequisite)", () => {
    const gate    = new AuthorityGate();
    const seq     = new IntentSequencer();
    const factory = new IntentFactory(seq);
    const a = factory.create({ type: CoreCommandType.PLAY });
    const b = factory.create({ type: CoreCommandType.PAUSE });
    gate.register(a);
    gate.register(b);
    assert.ok(!gate.isAuthoritative(a), "first intent must be superseded");
    assert.ok(gate.isAuthoritative(b),  "second intent must be authoritative");
  });

  test("only the most recently registered intent is authoritative", () => {
    const gate    = new AuthorityGate();
    const seq     = new IntentSequencer();
    const factory = new IntentFactory(seq);
    const intents = Array.from({ length: 10 }, () => factory.create({ type: CoreCommandType.NEXT }));
    intents.forEach((i) => gate.register(i));
    const last = intents[intents.length - 1];
    assert.ok(gate.isAuthoritative(last));
    for (const i of intents.slice(0, -1)) {
      assert.ok(!gate.isAuthoritative(i), `intent seq=${i.sequence} should be superseded`);
    }
  });

  test("register throws for non-monotonic sequence", () => {
    const gate    = new AuthorityGate();
    const seq     = new IntentSequencer();
    const factory = new IntentFactory(seq);
    const a = factory.create({ type: CoreCommandType.PLAY });
    gate.register(a);
    assert.throws(
      () => gate.register({ sequence: 0, intentId: "00000000:0" }),
      { name: "RangeError" }
    );
  });

  test("isAuthoritative returns false for null or malformed intent", () => {
    const gate = new AuthorityGate();
    assert.equal(gate.isAuthoritative(null), false);
    assert.equal(gate.isAuthoritative({}), false);
    assert.equal(gate.isAuthoritative({ sequence: "not-a-number" }), false);
  });

  test("hasAuthority is false before any registration", () => {
    const gate = new AuthorityGate();
    assert.equal(gate.hasAuthority, false);
    const seq = new IntentSequencer();
    const factory = new IntentFactory(seq);
    gate.register(factory.create({ type: CoreCommandType.PLAY }));
    assert.equal(gate.hasAuthority, true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// INV-06: DomainStore — frozen snapshots, independent subscriptions
// ─────────────────────────────────────────────────────────────────────────────

describe("INV-06: DomainStore — snapshot integrity and isolation", () => {
  test("initial snapshot is frozen", () => {
    const store = new DomainStore("test", { value: 1 });
    const snap  = store.getSnapshot();
    assert.ok(Object.isFrozen(snap));
    assert.throws(() => { snap.value = 99; });
  });

  test("snapshot reference is stable between commits", () => {
    const store = new DomainStore("test", { value: 1 });
    const ref1  = store.getSnapshot();
    const ref2  = store.getSnapshot();
    assert.equal(ref1, ref2, "same frozen reference before any commit");
  });

  test("_applyCommit updates snapshot and version", () => {
    const store = new DomainStore("test", { value: 0 });
    store._applyCommit({ value: 42 });
    const snap = store.getSnapshot();
    assert.equal(snap.value, 42);
    assert.equal(store.version, 1);
    assert.ok(Object.isFrozen(snap));
  });

  test("_applyCommit notifies subscribers", () => {
    const store  = new DomainStore("test", { value: 0 });
    const calls  = [];
    store.subscribe((snap, version) => calls.push({ snap, version }));
    store._applyCommit({ value: 7 });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].snap.value, 7);
    assert.equal(calls[0].version, 1);
  });

  test("subscribe returns an unsubscribe function", () => {
    const store = new DomainStore("test", { value: 0 });
    const calls = [];
    const unsub = store.subscribe((snap) => calls.push(snap));
    store._applyCommit({ value: 1 });
    unsub();
    store._applyCommit({ value: 2 });
    assert.equal(calls.length, 1, "subscriber should have been removed");
  });

  test("two stores have completely independent subscriptions", () => {
    const storeA = new DomainStore("a", { x: 0 });
    const storeB = new DomainStore("b", { y: 0 });
    const callsA = [];
    const callsB = [];
    storeA.subscribe((s) => callsA.push(s));
    storeB.subscribe((s) => callsB.push(s));

    storeA._applyCommit({ x: 1 });

    assert.equal(callsA.length, 1, "storeA subscriber must fire");
    assert.equal(callsB.length, 0, "storeB subscriber must NOT fire when storeA commits");
  });

  test("listener errors do not crash the commit", () => {
    const store = new DomainStore("test", { value: 0 });
    store.subscribe(() => { throw new Error("listener explosion"); });
    store.subscribe(() => { /* no-op second listener */ });
    // Must not throw — the store absorbs listener errors
    assert.doesNotThrow(() => store._applyCommit({ value: 99 }));
    assert.equal(store.getSnapshot().value, 99);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// INV-OWN: DomainOwnershipRegistry
// ─────────────────────────────────────────────────────────────────────────────

describe("INV-OWN: DomainOwnershipRegistry — single writer enforcement", () => {
  test("all domains start LEGACY", () => {
    const registry = new DomainOwnershipRegistry();
    for (const domain of Object.values(Domain)) {
      assert.equal(registry.getOwner(domain), DomainOwner.LEGACY,
        `${domain} must start LEGACY`);
    }
  });

  test("transferToCore makes the domain Core-owned", () => {
    const registry = new DomainOwnershipRegistry();
    registry.transferToCore(Domain.TRANSPORT);
    assert.equal(registry.getOwner(Domain.TRANSPORT), DomainOwner.CORE);
  });

  test("transferToCore is idempotent — no error on double call", () => {
    const registry = new DomainOwnershipRegistry();
    assert.doesNotThrow(() => {
      registry.transferToCore(Domain.SELECTION);
      registry.transferToCore(Domain.SELECTION);
    });
    assert.equal(registry.getOwner(Domain.SELECTION), DomainOwner.CORE);
  });

  test("isOwnedByCore returns false for LEGACY, true for CORE", () => {
    const registry = new DomainOwnershipRegistry();
    assert.equal(registry.isOwnedByCore(Domain.CAPABILITY), false);
    registry.transferToCore(Domain.CAPABILITY);
    assert.equal(registry.isOwnedByCore(Domain.CAPABILITY), true);
  });

  test("transferring one domain does not affect others", () => {
    const registry = new DomainOwnershipRegistry();
    registry.transferToCore(Domain.TRANSPORT);
    assert.equal(registry.getOwner(Domain.SELECTION),         DomainOwner.LEGACY);
    assert.equal(registry.getOwner(Domain.CAPABILITY),        DomainOwner.LEGACY);
    assert.equal(registry.getOwner(Domain.CONTINUITY),        DomainOwner.LEGACY);
    assert.equal(registry.getOwner(Domain.MEDIA_PREPARATION), DomainOwner.LEGACY);
  });

  test("unknown domain defaults to LEGACY", () => {
    const registry = new DomainOwnershipRegistry();
    assert.equal(registry.getOwner("UNKNOWN_DOMAIN"), DomainOwner.LEGACY);
  });

  test("getOwnershipMap returns current state as plain object", () => {
    const registry = new DomainOwnershipRegistry();
    registry.transferToCore(Domain.TRANSPORT);
    const map = registry.getOwnershipMap();
    assert.equal(map[Domain.TRANSPORT], DomainOwner.CORE);
    assert.equal(map[Domain.SELECTION], DomainOwner.LEGACY);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// INV-01 + INV-02: CommitGate — authority + ownership enforcement
// ─────────────────────────────────────────────────────────────────────────────

describe("INV-01 + INV-02: CommitGate — the single write boundary", () => {
  test("INV-01: superseded intent cannot commit state (SUPERSEDED rejection)", () => {
    const { authorityGate, ownershipRegistry, stores, logger, commitGate, intentFactory } =
      makeFullStack();

    ownershipRegistry.transferToCore(Domain.TRANSPORT);

    const a = intentFactory.create({ type: CoreCommandType.PLAY });
    const b = intentFactory.create({ type: CoreCommandType.PAUSE });
    authorityGate.register(a);
    authorityGate.register(b);  // b supersedes a

    const result = commitGate.propose({
      intent:    a,
      storeKey:  StoreKey.TRANSPORT_STATUS,
      domain:    Domain.TRANSPORT,
      snapshot:  { playing: true, buffering: false, seeking: false, error: null },
    });

    assert.equal(result.accepted, false);
    assert.equal(result.rejectionReason, CommitRejectionReason.SUPERSEDED);
  });

  test("INV-02: LEGACY-owned domain cannot be committed through Core path", () => {
    const { authorityGate, stores, logger, commitGate, intentFactory } = makeFullStack();
    // Domain.TRANSPORT remains LEGACY (default)

    const intent = intentFactory.create({ type: CoreCommandType.PLAY });
    authorityGate.register(intent);

    const result = commitGate.propose({
      intent,
      storeKey: StoreKey.TRANSPORT_STATUS,
      domain:   Domain.TRANSPORT,
      snapshot: { playing: true, buffering: false, seeking: false, error: null },
    });

    assert.equal(result.accepted, false);
    assert.equal(result.rejectionReason, CommitRejectionReason.DOMAIN_NOT_OWNED_BY_CORE);
  });

  test("commit accepted when authoritative + Core-owned", () => {
    const { authorityGate, ownershipRegistry, stores, commitGate, intentFactory } =
      makeFullStack();

    ownershipRegistry.transferToCore(Domain.TRANSPORT);
    const intent = intentFactory.create({ type: CoreCommandType.PLAY });
    authorityGate.register(intent);

    const snapshot = { playing: true, buffering: false, seeking: false, error: null };
    const result   = commitGate.propose({
      intent,
      storeKey: StoreKey.TRANSPORT_STATUS,
      domain:   Domain.TRANSPORT,
      snapshot,
    });

    assert.equal(result.accepted, true);
    assert.equal(result.rejectionReason, null);
    assert.equal(result.newVersion, 1);

    // Verify the store received the snapshot
    const stored = stores.get(StoreKey.TRANSPORT_STATUS).getSnapshot();
    assert.equal(stored.playing, true);
  });

  test("commit rejected for unknown storeKey", () => {
    const { authorityGate, ownershipRegistry, commitGate, intentFactory } = makeFullStack();
    ownershipRegistry.transferToCore(Domain.TRANSPORT);

    const intent = intentFactory.create({ type: CoreCommandType.PLAY });
    authorityGate.register(intent);

    const result = commitGate.propose({
      intent,
      storeKey: "NONEXISTENT_STORE",
      domain:   Domain.TRANSPORT,
      snapshot: {},
    });

    assert.equal(result.accepted, false);
    assert.equal(result.rejectionReason, CommitRejectionReason.INVALID_INTENT);
  });

  test("extra validators are called and can reject", () => {
    const sequencer         = new IntentSequencer();
    const intentFactory     = new IntentFactory(sequencer);
    const authorityGate     = new AuthorityGate();
    const ownershipRegistry = new DomainOwnershipRegistry();
    const stores            = createDomainStores();
    const logger            = new CoreLogger({ enabled: false });

    const blockAll = () => CommitRejectionReason.EPOCH_MISMATCH;
    const commitGate = new CommitGate({
      authorityGate,
      ownershipRegistry,
      stores,
      logger,
      extraValidators: [blockAll],
    });

    ownershipRegistry.transferToCore(Domain.TRANSPORT);
    const intent = intentFactory.create({ type: CoreCommandType.PLAY });
    authorityGate.register(intent);

    const result = commitGate.propose({
      intent,
      storeKey: StoreKey.TRANSPORT_STATUS,
      domain:   Domain.TRANSPORT,
      snapshot: { playing: false },
    });

    assert.equal(result.accepted, false);
    assert.equal(result.rejectionReason, CommitRejectionReason.EPOCH_MISMATCH);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// INV-17: sessionEpoch is stable and owned by PlaybackCore
// ─────────────────────────────────────────────────────────────────────────────

describe("INV-17: sessionEpoch owned by PlaybackCore — never reset by auth", () => {
  test("sessionEpoch is stable across many commands", () => {
    const { gateway, sequencer } = makeGateway();
    const epoch = sequencer.sessionEpoch;
    for (let i = 0; i < 50; i++) {
      gateway.dispatch(CoreCommandType.NEXT, {});
    }
    assert.equal(sequencer.sessionEpoch, epoch);
  });

  test("two PlaybackCore instances have different sessionEpochs", () => {
    const a = PlaybackCore.create({ loggerEnabled: false });
    const b = PlaybackCore.create({ loggerEnabled: false });
    assert.notEqual(a.sessionEpoch, b.sessionEpoch);
    a.destroy();
    b.destroy();
  });

  test("epoch embedded in every intentId matches sessionEpoch", () => {
    const sequencer     = new IntentSequencer();
    const intentFactory = new IntentFactory(sequencer);
    const intent        = intentFactory.create({ type: CoreCommandType.PLAY });
    const [epoch]       = intent.intentId.split(":");
    assert.equal(epoch, sequencer.sessionEpoch);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// INV-LOG: CoreLogger ring buffer
// ─────────────────────────────────────────────────────────────────────────────

describe("INV-LOG: CoreLogger — ring buffer and subscriptions", () => {
  test("emits events and history is returned in order", () => {
    const logger = new CoreLogger();
    logger.emit({ type: "TEST_A" });
    logger.emit({ type: "TEST_B" });
    const history = logger.getHistory();
    assert.equal(history.length, 2);
    assert.equal(history[0].type, "TEST_A");
    assert.equal(history[1].type, "TEST_B");
  });

  test("ring buffer caps at 200 events", () => {
    const logger = new CoreLogger();
    for (let i = 0; i < 250; i++) {
      logger.emit({ type: "TICK", i });
    }
    const history = logger.getHistory();
    assert.equal(history.length, 200, "ring must not exceed 200");
    assert.equal(logger.totalEmitted, 250, "totalEmitted counts all events");
  });

  test("ring buffer returns oldest-first after wrap", () => {
    const logger = new CoreLogger();
    for (let i = 0; i < 210; i++) {
      logger.emit({ type: "TICK", i });
    }
    const history = logger.getHistory();
    // oldest retained event is index 10 (events 0-9 were evicted)
    assert.equal(history[0].i, 10);
    assert.equal(history[history.length - 1].i, 209);
  });

  test("subscribe receives events and unsub stops delivery", () => {
    const logger = new CoreLogger();
    const received = [];
    const unsub = logger.subscribe((e) => received.push(e));
    logger.emit({ type: "A" });
    unsub();
    logger.emit({ type: "B" });
    assert.equal(received.length, 1);
    assert.equal(received[0].type, "A");
  });

  test("disabled logger emits nothing", () => {
    const logger = new CoreLogger({ enabled: false });
    logger.emit({ type: "SHOULD_NOT_APPEAR" });
    assert.equal(logger.getHistory().length, 0);
    assert.equal(logger.totalEmitted, 0);
  });

  test("emitCoreInitialized stamps the session epoch", () => {
    const logger = new CoreLogger();
    const seq    = new IntentSequencer();
    logger.emitCoreInitialized({ sessionEpoch: seq.sessionEpoch });
    const history = logger.getHistory();
    assert.equal(history[0].type, "CORE_INITIALIZED");
    assert.equal(history[0].sessionEpoch, seq.sessionEpoch);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// INV-PORT: PlaybackPort public surface
// ─────────────────────────────────────────────────────────────────────────────

describe("INV-PORT: PlaybackPort — complete stable API", () => {
  function makePort() {
    const { gateway } = makeGateway();
    const port = new PlaybackPort(gateway);
    return port;
  }

  test("play() dispatches without throwing", () => {
    assert.doesNotThrow(() => makePort().play({ trackId: "t1" }));
  });

  test("pause() dispatches without throwing", () => {
    assert.doesNotThrow(() => makePort().pause());
  });

  test("resume() dispatches without throwing", () => {
    assert.doesNotThrow(() => makePort().resume());
  });

  test("seek() dispatches without throwing for valid position", () => {
    assert.doesNotThrow(() => makePort().seek({ positionSeconds: 30 }));
  });

  test("seek() throws for negative position", () => {
    assert.throws(() => makePort().seek({ positionSeconds: -1 }), { name: "TypeError" });
  });

  test("next() dispatches without throwing", () => {
    assert.doesNotThrow(() => makePort().next());
  });

  test("previous() dispatches without throwing", () => {
    assert.doesNotThrow(() => makePort().previous());
  });

  test("setQueue() dispatches without throwing for valid array", () => {
    assert.doesNotThrow(() => makePort().setQueue({ queueEntries: [{ trackId: "t1" }] }));
  });

  test("setQueue() throws for non-array", () => {
    assert.throws(() => makePort().setQueue({ queueEntries: "not-an-array" }), { name: "TypeError" });
  });

  test("reorderQueue() dispatches without throwing", () => {
    assert.doesNotThrow(() => makePort().reorderQueue({ fromIndex: 0, toIndex: 2 }));
  });

  test("reorderQueue() throws for non-number indices", () => {
    assert.throws(() => makePort().reorderQueue({ fromIndex: "a", toIndex: 0 }), { name: "TypeError" });
  });

  test("every command increments the intent sequence", () => {
    const seq     = new IntentSequencer();
    const factory = new IntentFactory(seq);
    const gate    = new AuthorityGate();
    const logger  = new CoreLogger({ enabled: false });
    const gateway = new CommandGateway({ intentFactory: factory, authorityGate: gate, logger });
    const port    = new PlaybackPort(gateway);

    port.play({ trackId: "t1" });
    port.pause();
    port.resume();
    port.next();
    port.previous();

    assert.equal(seq.currentSequence, 5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// INV-CORE: PlaybackCore integration
// ─────────────────────────────────────────────────────────────────────────────

describe("INV-CORE: PlaybackCore.create() — full wiring", () => {
  test("create() returns a live core with a valid port", () => {
    const core = PlaybackCore.create({ loggerEnabled: false });
    assert.ok(core.port, "port must exist");
    assert.ok(core.sessionEpoch.match(/^[0-9a-f]{8}$/), "sessionEpoch format");
    core.destroy();
  });

  test("port.play() is accepted without throwing", () => {
    const core = PlaybackCore.create({ loggerEnabled: false });
    assert.doesNotThrow(() => core.port.play({ trackId: "t1" }));
    core.destroy();
  });

  test("destroy() emits CORE_DESTROYED event", () => {
    const core  = PlaybackCore.create({ loggerEnabled: true });
    const events = [];
    core.logger.subscribe((e) => events.push(e));
    core.destroy();
    const destroyed = events.find((e) => e.type === "CORE_DESTROYED");
    assert.ok(destroyed, "CORE_DESTROYED event must be emitted");
    assert.equal(destroyed.sessionEpoch, core.sessionEpoch);
  });

  test("destroy() prevents further port access", () => {
    const core = PlaybackCore.create({ loggerEnabled: false });
    core.destroy();
    assert.throws(() => core.port.play(), { message: /destroyed/ });
  });

  test("destroy() is idempotent", () => {
    const core = PlaybackCore.create({ loggerEnabled: false });
    assert.doesNotThrow(() => { core.destroy(); core.destroy(); core.destroy(); });
  });

  test("logger emits CORE_INITIALIZED on create()", () => {
    const core    = PlaybackCore.create({ loggerEnabled: true });
    const history = core.logger.getHistory();
    assert.ok(
      history.some((e) => e.type === "CORE_INITIALIZED"),
      "CORE_INITIALIZED must appear in history"
    );
    core.destroy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// INV-ADAPT: LegacyPlaybackAdapter — read-only migration seam
// ─────────────────────────────────────────────────────────────────────────────

describe("INV-ADAPT: LegacyPlaybackAdapter — read-only seam", () => {
  test("returns null for LEGACY-owned domain (Slice 0: all domains)", () => {
    const { legacyAdapter } = makeFullStack();
    const snap = legacyAdapter.getSnapshot(StoreKey.TRANSPORT_STATUS, Domain.TRANSPORT);
    assert.equal(snap, null, "all domains are LEGACY in Slice 0 — must return null");
  });

  test("returns frozen snapshot after domain transferred to Core", () => {
    const { legacyAdapter, ownershipRegistry, stores } = makeFullStack();
    ownershipRegistry.transferToCore(Domain.TRANSPORT);
    const snap = legacyAdapter.getSnapshot(StoreKey.TRANSPORT_STATUS, Domain.TRANSPORT);
    assert.ok(snap !== null, "Core-owned domain must return snapshot");
    assert.ok(Object.isFrozen(snap), "snapshot must be frozen");
  });

  test("subscribe returns null for LEGACY-owned domain", () => {
    const { legacyAdapter } = makeFullStack();
    const unsub = legacyAdapter.subscribe(StoreKey.TRANSPORT_STATUS, Domain.TRANSPORT, () => {});
    assert.equal(unsub, null);
  });

  test("subscribe returns unsubscribe fn for Core-owned domain", () => {
    const { legacyAdapter, ownershipRegistry } = makeFullStack();
    ownershipRegistry.transferToCore(Domain.TRANSPORT);
    const unsub = legacyAdapter.subscribe(StoreKey.TRANSPORT_STATUS, Domain.TRANSPORT, () => {});
    assert.equal(typeof unsub, "function");
    unsub();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// INV-FACTORY: IntentFactory shape
// ─────────────────────────────────────────────────────────────────────────────

describe("INV-FACTORY: IntentFactory — frozen intent shape", () => {
  test("created intent is frozen", () => {
    const seq     = new IntentSequencer();
    const factory = new IntentFactory(seq);
    const intent  = factory.create({ type: CoreCommandType.PLAY });
    assert.ok(Object.isFrozen(intent));
  });

  test("intent has all required fields", () => {
    const seq     = new IntentSequencer();
    const factory = new IntentFactory(seq);
    const intent  = factory.create({ type: CoreCommandType.PLAY, source: "test" });
    assert.ok(typeof intent.intentId     === "string");
    assert.ok(typeof intent.sessionEpoch === "string");
    assert.ok(typeof intent.sequence     === "number");
    assert.ok(typeof intent.type         === "string");
    assert.ok(typeof intent.source       === "string");
    assert.ok(typeof intent.createdAt    === "number");
  });

  test("optional fields omitted when undefined", () => {
    const seq     = new IntentSequencer();
    const factory = new IntentFactory(seq);
    const intent  = factory.create({ type: CoreCommandType.PAUSE });
    assert.ok(!("trackId"          in intent));
    assert.ok(!("resumePolicy"     in intent));
    assert.ok(!("positionSeconds"  in intent));
    assert.ok(!("queueEntries"     in intent));
    assert.ok(!("queueIndex"       in intent));
  });

  test("optional fields included when provided", () => {
    const seq     = new IntentSequencer();
    const factory = new IntentFactory(seq);
    const intent  = factory.create({
      type:            CoreCommandType.PLAY,
      trackId:         "t1",
      resumePolicy:    ResumePolicy.RESUME_IF_AVAILABLE,
      positionSeconds: 0,
      queueEntries:    [],
      queueIndex:      0,
      fromIndex:       1,
      toIndex:         3,
    });
    assert.equal(intent.trackId,         "t1");
    assert.equal(intent.resumePolicy,    ResumePolicy.RESUME_IF_AVAILABLE);
    assert.equal(intent.positionSeconds, 0);
    assert.deepEqual(intent.queueEntries, []);
  });

  test("source defaults to 'unknown' when omitted", () => {
    const seq     = new IntentSequencer();
    const factory = new IntentFactory(seq);
    const intent  = factory.create({ type: CoreCommandType.NEXT });
    assert.equal(intent.source, "unknown");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// INV-TYPES: Type constants completeness
// ─────────────────────────────────────────────────────────────────────────────

describe("INV-TYPES: Type constants — completeness and immutability", () => {
  test("CoreCommandType has all 8 command types", () => {
    const expected = ["PLAY", "PAUSE", "RESUME", "SEEK", "NEXT", "PREVIOUS", "SET_QUEUE", "REORDER_QUEUE"];
    for (const cmd of expected) {
      assert.ok(cmd in CoreCommandType, `CoreCommandType.${cmd} must exist`);
    }
  });

  test("ResumePolicy has all 5 variants", () => {
    const expected = [
      "START_FROM_BEGINNING", "RESUME_IF_AVAILABLE", "RESUME_EXACT_POSITION",
      "CONTINUE_CURRENT_SESSION", "RESTART_RELEASE",
    ];
    for (const rp of expected) {
      assert.ok(rp in ResumePolicy, `ResumePolicy.${rp} must exist`);
    }
  });

  test("Domain has all 5 domains", () => {
    const expected = ["TRANSPORT", "SELECTION", "CAPABILITY", "CONTINUITY", "MEDIA_PREPARATION"];
    for (const d of expected) {
      assert.ok(d in Domain, `Domain.${d} must exist`);
    }
  });

  test("StoreKey has all 8 store keys", () => {
    const expected = [
      "NOW_PLAYING", "TRANSPORT_STATUS", "TRANSPORT_TIMELINE",
      "TRANSPORT_MODE", "QUEUE", "CAPABILITY", "CONTINUITY", "DIAGNOSTICS",
    ];
    for (const k of expected) {
      assert.ok(k in StoreKey, `StoreKey.${k} must exist`);
    }
  });

  test("type constant objects are frozen", () => {
    assert.ok(Object.isFrozen(CoreCommandType));
    assert.ok(Object.isFrozen(ResumePolicy));
    assert.ok(Object.isFrozen(DomainOwner));
    assert.ok(Object.isFrozen(Domain));
    assert.ok(Object.isFrozen(StoreKey));
    assert.ok(Object.isFrozen(CommitRejectionReason));
  });
});
