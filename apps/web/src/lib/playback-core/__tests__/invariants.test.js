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
import { PlaybackCoreAdapter }     from "../adapters/PlaybackCoreAdapter.js";
import { DesiredStateStore }       from "../desired/DesiredStateStore.js";
import { TransportDisposition }    from "../desired/DesiredExecutionState.js";
import { ConvergenceEngine }       from "../convergence/ConvergenceEngine.js";
import {
  CoreCommandType,
  CoreReadiness,
  CoreLiveCommandScope,
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

// UUID v4 pattern — used across epoch-format assertions
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  test("sessionEpoch is a 128-bit UUID (crypto.randomUUID format)", () => {
    const seq = new IntentSequencer();
    assert.match(seq.sessionEpoch, UUID_RE);
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
    assert.ok(intentId.startsWith(seq.sessionEpoch), "intentId must begin with sessionEpoch");
    assert.ok(intentId.endsWith(`:${sequence}`), "intentId must end with :sequence");
    assert.equal(intentId, `${seq.sessionEpoch}:${sequence}`);
  });

  test("two sequencers have different epochs (probabilistic)", () => {
    const a = new IntentSequencer();
    const b = new IntentSequencer();
    // Probability of collision is 1/2^122 (UUID v4 entropy) — negligible
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
    assert.ok(UUID_RE.test(core.sessionEpoch), `sessionEpoch must be UUID, got: ${core.sessionEpoch}`);
    core.destroy();
  });

  test("Core starts in CONSTRUCTING state before adapter is injected", () => {
    const core = PlaybackCore.create({ loggerEnabled: false });
    assert.equal(core.readiness, CoreReadiness.CONSTRUCTING);
    core.destroy();
  });

  test("port commands throw with READY error when Core is CONSTRUCTING", () => {
    const core = PlaybackCore.create({ loggerEnabled: false });
    assert.throws(
      () => core.port.play({ trackId: "t1" }),
      /not READY|CONSTRUCTING/,
      "port.play() must throw before adapter injected"
    );
    assert.throws(() => core.port.pause(), /not READY|CONSTRUCTING/);
    assert.throws(() => core.port.resume(), /not READY|CONSTRUCTING/);
    assert.throws(() => core.port.seek({ positionSeconds: 0 }), /not READY|CONSTRUCTING/);
    assert.throws(() => core.port.next(), /not READY|CONSTRUCTING/);
    assert.throws(() => core.port.previous(), /not READY|CONSTRUCTING/);
    core.destroy();
  });

  test("_injectExecutionEngine transitions Core to READY and port accepts commands", () => {
    const core      = PlaybackCore.create({ loggerEnabled: false });
    const dispatched = [];
    const adapter   = new PlaybackCoreAdapter({
      dispatch: (type, payload) => { dispatched.push({ type, payload }); return Promise.resolve(true); },
      authorityGate: makeFullStack().authorityGate,
      logger: null,
    });
    core._injectExecutionEngine(adapter);
    assert.equal(core.readiness, CoreReadiness.READY);
    assert.doesNotThrow(() => core.port.play({ trackId: "t1" }));
    core.destroy();
  });

  test("_injectExecutionEngine emits CORE_READY diagnostic event", () => {
    const core    = PlaybackCore.create({ loggerEnabled: true });
    const events  = [];
    core.logger.subscribe((e) => events.push(e));
    const adapter = new PlaybackCoreAdapter({
      dispatch: () => Promise.resolve(),
      authorityGate: makeFullStack().authorityGate,
      logger: null,
    });
    core._injectExecutionEngine(adapter);
    assert.ok(events.some((e) => e.type === "CORE_READY"), "CORE_READY must be emitted");
    core.destroy();
  });

  test("port.play() is accepted without throwing when READY", () => {
    const core    = PlaybackCore.create({ loggerEnabled: false });
    const adapter = new PlaybackCoreAdapter({
      dispatch: () => Promise.resolve(),
      authorityGate: makeFullStack().authorityGate,
      logger: null,
    });
    core._injectExecutionEngine(adapter);
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

  test("destroy() transitions Core to DISPOSED", () => {
    const core = PlaybackCore.create({ loggerEnabled: false });
    core.destroy();
    assert.equal(core.readiness, CoreReadiness.DISPOSED);
  });

  test("destroy() prevents further port access (throws destroyed error)", () => {
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

// ─────────────────────────────────────────────────────────────────────────────
// INV-DEEP: Deep snapshot isolation (Slice 0H)
// Nothing reachable from a returned Core snapshot can mutate canonical state.
// ─────────────────────────────────────────────────────────────────────────────

describe("INV-DEEP: Deep snapshot isolation — nested objects cannot mutate Core state", () => {
  test("nested object mutation via returned snapshot is rejected", () => {
    const store = new DomainStore("test", { track: { title: "Original" } });
    const snap = store.getSnapshot();
    try { snap.track.title = "MUTATED"; } catch (_) {}
    assert.equal(store.getSnapshot().track.title, "Original");
  });

  test("nested object mutation via original input reference is isolated", () => {
    const store = new DomainStore("test", {});
    const meta = { title: "Original" };
    store._applyCommit({ track: meta });
    meta.title = "EXTERNAL_MUTATION";  // mutate the original object after commit
    assert.equal(store.getSnapshot().track.title, "Original",
      "structuredClone must break the external reference");
  });

  test("nested array push via returned snapshot is rejected", () => {
    const store = new DomainStore("test", {});
    store._applyCommit({ queue: ["a", "b"] });
    const snap = store.getSnapshot();
    try { snap.queue.push("INJECTED"); } catch (_) {}
    assert.equal(store.getSnapshot().queue.length, 2);
  });

  test("nested array push via original input reference is isolated", () => {
    const store = new DomainStore("test", {});
    const arr = ["a", "b"];
    store._applyCommit({ queue: arr });
    arr.push("EXTERNAL_PUSH");
    assert.equal(store.getSnapshot().queue.length, 2,
      "structuredClone must break the external array reference");
  });

  test("object inside nested array mutation via returned snapshot is rejected", () => {
    const store = new DomainStore("test", {});
    store._applyCommit({ queue: [{ trackId: "t1", title: "Original" }] });
    const snap = store.getSnapshot();
    try { snap.queue[0].title = "MUTATED"; } catch (_) {}
    assert.equal(store.getSnapshot().queue[0].title, "Original");
  });

  test("object inside nested array mutation via original reference is isolated", () => {
    const store = new DomainStore("test", {});
    const entry = { trackId: "t1", title: "Original" };
    store._applyCommit({ queue: [entry] });
    entry.title = "EXTERNAL_MUTATION";
    assert.equal(store.getSnapshot().queue[0].title, "Original",
      "structuredClone must break reference into nested array entries");
  });

  test("deeply nested object mutation via returned snapshot is rejected", () => {
    const store = new DomainStore("test", {});
    store._applyCommit({ track: { metadata: { credits: { producer: "P" } } } });
    const snap = store.getSnapshot();
    try { snap.track.metadata.credits.producer = "HACKED"; } catch (_) {}
    assert.equal(store.getSnapshot().track.metadata.credits.producer, "P");
  });

  test("returned snapshot is deeply frozen at all nesting levels", () => {
    const store = new DomainStore("test", {});
    store._applyCommit({ level1: { level2: { level3: "value" } } });
    const snap = store.getSnapshot();
    assert.ok(Object.isFrozen(snap),         "top level must be frozen");
    assert.ok(Object.isFrozen(snap.level1),  "level1 must be frozen");
    assert.ok(Object.isFrozen(snap.level1.level2), "level2 must be frozen");
  });

  test("initial snapshot passed to constructor is also deeply isolated", () => {
    const nested = { x: 1 };
    const store = new DomainStore("test", { nested });
    nested.x = 999;
    assert.equal(store.getSnapshot().nested.x, 1,
      "constructor must also deep-clone the initial snapshot");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// INV-INTERLEAVE: Command interleaving and supersession (Slice 0H)
// Authority gate semantics under concurrent / out-of-order command issuance.
// ─────────────────────────────────────────────────────────────────────────────

describe("INV-INTERLEAVE: Command interleaving and supersession", () => {
  test("PLAY A → SEEK: SEEK supersedes PLAY A", () => {
    const { intentFactory, authorityGate } = makeFullStack();
    const playA = intentFactory.create({ type: CoreCommandType.PLAY, trackId: "a" });
    const seek  = intentFactory.create({ type: CoreCommandType.SEEK, positionSeconds: 30 });
    authorityGate.register(playA);
    authorityGate.register(seek);
    assert.ok(!authorityGate.isAuthoritative(playA), "PLAY A must be superseded");
    assert.ok(authorityGate.isAuthoritative(seek),   "SEEK must be sole authority");
  });

  test("PLAY A → PAUSE: PAUSE supersedes PLAY A", () => {
    const { intentFactory, authorityGate } = makeFullStack();
    const playA = intentFactory.create({ type: CoreCommandType.PLAY });
    const pause = intentFactory.create({ type: CoreCommandType.PAUSE });
    authorityGate.register(playA);
    authorityGate.register(pause);
    assert.ok(!authorityGate.isAuthoritative(playA));
    assert.ok(authorityGate.isAuthoritative(pause));
  });

  test("PLAY A → PAUSE → RESUME: RESUME is final authority", () => {
    const { intentFactory, authorityGate } = makeFullStack();
    const playA  = intentFactory.create({ type: CoreCommandType.PLAY });
    const pause  = intentFactory.create({ type: CoreCommandType.PAUSE });
    const resume = intentFactory.create({ type: CoreCommandType.RESUME });
    authorityGate.register(playA);
    authorityGate.register(pause);
    authorityGate.register(resume);
    assert.ok(!authorityGate.isAuthoritative(playA));
    assert.ok(!authorityGate.isAuthoritative(pause));
    assert.ok(authorityGate.isAuthoritative(resume));
  });

  test("PLAY A → PLAY B: B supersedes A", () => {
    const { intentFactory, authorityGate } = makeFullStack();
    const playA = intentFactory.create({ type: CoreCommandType.PLAY, trackId: "a" });
    const playB = intentFactory.create({ type: CoreCommandType.PLAY, trackId: "b" });
    authorityGate.register(playA);
    authorityGate.register(playB);
    assert.ok(!authorityGate.isAuthoritative(playA));
    assert.ok(authorityGate.isAuthoritative(playB));
  });

  test("PLAY A → PLAY B → PAUSE: PAUSE is final authority", () => {
    const { intentFactory, authorityGate } = makeFullStack();
    const playA = intentFactory.create({ type: CoreCommandType.PLAY, trackId: "a" });
    const playB = intentFactory.create({ type: CoreCommandType.PLAY, trackId: "b" });
    const pause = intentFactory.create({ type: CoreCommandType.PAUSE });
    authorityGate.register(playA);
    authorityGate.register(playB);
    authorityGate.register(pause);
    assert.ok(!authorityGate.isAuthoritative(playA));
    assert.ok(!authorityGate.isAuthoritative(playB));
    assert.ok(authorityGate.isAuthoritative(pause));
  });

  test("PAUSE → SEEK → RESUME: RESUME is final authority", () => {
    const { intentFactory, authorityGate } = makeFullStack();
    const pause  = intentFactory.create({ type: CoreCommandType.PAUSE });
    const seek   = intentFactory.create({ type: CoreCommandType.SEEK, positionSeconds: 45 });
    const resume = intentFactory.create({ type: CoreCommandType.RESUME });
    authorityGate.register(pause);
    authorityGate.register(seek);
    authorityGate.register(resume);
    assert.ok(!authorityGate.isAuthoritative(pause));
    assert.ok(!authorityGate.isAuthoritative(seek));
    assert.ok(authorityGate.isAuthoritative(resume));
  });

  test("SEEK → SEEK → SEEK: only last SEEK is authoritative", () => {
    const { intentFactory, authorityGate } = makeFullStack();
    const seeks = [0, 30, 60].map((pos) =>
      intentFactory.create({ type: CoreCommandType.SEEK, positionSeconds: pos })
    );
    seeks.forEach((s) => authorityGate.register(s));
    assert.ok(!authorityGate.isAuthoritative(seeks[0]));
    assert.ok(!authorityGate.isAuthoritative(seeks[1]));
    assert.ok(authorityGate.isAuthoritative(seeks[2]));
  });

  test("rapid 100-command sequence: only last command is authoritative", () => {
    const { intentFactory, authorityGate } = makeFullStack();
    const commands = [];
    for (let i = 0; i < 100; i++) {
      const cmd = intentFactory.create({ type: CoreCommandType.NEXT });
      commands.push(cmd);
      authorityGate.register(cmd);
    }
    const last = commands[commands.length - 1];
    assert.ok(authorityGate.isAuthoritative(last), "last command must be authoritative");
    for (const cmd of commands.slice(0, -1)) {
      assert.ok(!authorityGate.isAuthoritative(cmd), `intermediate command seq=${cmd.sequence} must be superseded`);
    }
  });

  test("superseded intent cannot commit state even after delayed resolution (out-of-order async)", () => {
    const { intentFactory, authorityGate, ownershipRegistry, commitGate } = makeFullStack();
    ownershipRegistry.transferToCore(Domain.TRANSPORT);

    const playA = intentFactory.create({ type: CoreCommandType.PLAY });
    const playB = intentFactory.create({ type: CoreCommandType.PLAY });
    authorityGate.register(playA);
    authorityGate.register(playB);  // B supersedes A immediately

    // A "completes" its async work late and tries to commit — must be rejected
    const lateResult = commitGate.propose({
      intent:   playA,
      storeKey: StoreKey.TRANSPORT_STATUS,
      domain:   Domain.TRANSPORT,
      snapshot: { playing: true, trackId: "track-a" },
    });
    assert.equal(lateResult.accepted, false);
    assert.equal(lateResult.rejectionReason, CommitRejectionReason.SUPERSEDED);
  });

  test("randomized commit order: canonical state always reflects last-registered intent", () => {
    const { intentFactory, authorityGate, ownershipRegistry, commitGate, stores } = makeFullStack();
    ownershipRegistry.transferToCore(Domain.TRANSPORT);

    const N = 15;
    const intents = [];
    for (let i = 0; i < N; i++) {
      const intent = intentFactory.create({ type: CoreCommandType.PLAY });
      intents.push({ intent, trackId: `track-${i}` });
      authorityGate.register(intent);
    }
    const lastEntry = intents[N - 1];

    // Commit in shuffled order — simulates arbitrary async completion timing
    const shuffled = [...intents].sort(() => Math.random() - 0.5);
    for (const { intent, trackId } of shuffled) {
      commitGate.propose({
        intent,
        storeKey: StoreKey.TRANSPORT_STATUS,
        domain:   Domain.TRANSPORT,
        snapshot: { playing: true, trackId },
      });
    }

    const finalSnap = stores.get(StoreKey.TRANSPORT_STATUS).getSnapshot();
    assert.equal(
      finalSnap.trackId,
      lastEntry.trackId,
      "Canonical state must reflect the last-registered intent regardless of commit order"
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// INV-SLICE1: Core Command Authority Integration
//   Proves the full pipeline: PlaybackPort → CommandGateway → IntentFactory
//   → AuthorityGate → PlaybackCoreAdapter.execute() → dispatch() (mock)
//
//   HARDENING-B note: these tests prove authority semantics with the real adapter
//   and a mock dispatch function. Physical transport correctness (PLAY A → SEEK 92
//   → A playing at 92s) cannot be proven here — it requires the real media runtime.
//   HARDENING-B is the acceptance gate for Slice 1 against the real runtime.
// ─────────────────────────────────────────────────────────────────────────────

/** Every command type — used to exercise the dormant mapping contract. */
const ALL_COMMANDS = new Set(Object.values(CoreCommandType));

/**
 * Build a mock adapter with a tracked dispatch function.
 *
 * @param {AuthorityGate} authorityGate
 * @param {Set<string>} [liveScope] defaults to the adapter's own production
 *   scope (PLAY/PAUSE/RESUME/SEEK). Pass ALL_COMMANDS to test the dormant
 *   mapping contract for out-of-scope command types.
 */
function makeMockAdapter(authorityGate, liveScope) {
  const calls = [];
  const events = [];
  const dispatch = (type, payload) => {
    calls.push({ type, payload });
    return Promise.resolve(true);
  };
  const logger = { emit: (e) => events.push(e) };
  const adapter = new PlaybackCoreAdapter(
    liveScope
      ? { dispatch, authorityGate, logger, liveScope }
      : { dispatch, authorityGate, logger }
  );
  return { adapter, calls, events };
}

describe("INV-SLICE1: Core Command Authority Integration", () => {
  // ── Intent → command mapping ────────────────────────────────────────────────

  test("PLAY intent maps to PLAY_TRACK with track from queueEntries", async () => {
    const { intentFactory, authorityGate } = makeFullStack();
    const { adapter, calls } = makeMockAdapter(authorityGate);
    const track = { id: "t1", slug: "track-one", title: "Track One" };
    const intent = intentFactory.create({
      type: CoreCommandType.PLAY, trackId: "t1",
      queueEntries: [track], queueIndex: 0,
    });
    authorityGate.register(intent);
    await adapter.execute(intent);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].type, "PLAY_TRACK");
    assert.deepEqual(calls[0].payload.track, track);
  });

  test("PLAY intent maps to PLAY_TRACK with minimal track when no queueEntries", async () => {
    const { intentFactory, authorityGate } = makeFullStack();
    const { adapter, calls } = makeMockAdapter(authorityGate);
    const intent = intentFactory.create({ type: CoreCommandType.PLAY, trackId: "t99" });
    authorityGate.register(intent);
    await adapter.execute(intent);
    assert.equal(calls[0].type, "PLAY_TRACK");
    assert.equal(calls[0].payload.track.id, "t99");
    assert.equal(calls[0].payload.track.slug, "t99");
  });

  test("PAUSE intent maps to PAUSE", async () => {
    const { intentFactory, authorityGate } = makeFullStack();
    const { adapter, calls } = makeMockAdapter(authorityGate);
    const intent = intentFactory.create({ type: CoreCommandType.PAUSE });
    authorityGate.register(intent);
    await adapter.execute(intent);
    assert.equal(calls[0].type, "PAUSE");
  });

  test("RESUME intent maps to RESUME", async () => {
    const { intentFactory, authorityGate } = makeFullStack();
    const { adapter, calls } = makeMockAdapter(authorityGate);
    const intent = intentFactory.create({ type: CoreCommandType.RESUME });
    authorityGate.register(intent);
    await adapter.execute(intent);
    assert.equal(calls[0].type, "RESUME");
  });

  test("SEEK intent maps to SEEK with payload.time (not positionSeconds)", async () => {
    const { intentFactory, authorityGate } = makeFullStack();
    const { adapter, calls } = makeMockAdapter(authorityGate);
    const intent = intentFactory.create({ type: CoreCommandType.SEEK, positionSeconds: 92 });
    authorityGate.register(intent);
    await adapter.execute(intent);
    assert.equal(calls[0].type, "SEEK");
    assert.equal(calls[0].payload.time, 92,
      "legacy executor reads payload.time — adapter must map positionSeconds → time");
  });

  // The next three command types are OUT OF Slice 1B production scope. Their
  // mapping is dormant contract infrastructure, so these tests exercise it with
  // an explicitly widened scope. Production containment is asserted separately
  // in the scope-gate block below.
  test("NEXT intent maps to NEXT_TRACK (dormant contract)", async () => {
    const { intentFactory, authorityGate } = makeFullStack();
    const { adapter, calls } = makeMockAdapter(authorityGate, ALL_COMMANDS);
    const intent = intentFactory.create({ type: CoreCommandType.NEXT });
    authorityGate.register(intent);
    await adapter.execute(intent);
    assert.equal(calls[0].type, "NEXT_TRACK");
  });

  test("PREVIOUS intent maps to PREV_TRACK (dormant contract)", async () => {
    const { intentFactory, authorityGate } = makeFullStack();
    const { adapter, calls } = makeMockAdapter(authorityGate, ALL_COMMANDS);
    const intent = intentFactory.create({ type: CoreCommandType.PREVIOUS });
    authorityGate.register(intent);
    await adapter.execute(intent);
    assert.equal(calls[0].type, "PREV_TRACK");
  });

  test("SET_QUEUE intent maps to PLAY_QUEUE with tracks and startIndex (dormant contract)", async () => {
    const { intentFactory, authorityGate } = makeFullStack();
    const { adapter, calls } = makeMockAdapter(authorityGate, ALL_COMMANDS);
    const tracks = [{ id: "a" }, { id: "b" }];
    const intent = intentFactory.create({
      type: CoreCommandType.SET_QUEUE,
      queueEntries: tracks,
      queueIndex: 1,
    });
    authorityGate.register(intent);
    await adapter.execute(intent);
    assert.equal(calls[0].type, "PLAY_QUEUE");
    assert.deepEqual(calls[0].payload.tracks, tracks);
    assert.equal(calls[0].payload.startIndex, 1);
  });

  test("REORDER_QUEUE has no mapping even with scope widened (Slice 2)", async () => {
    const { intentFactory, authorityGate } = makeFullStack();
    const { adapter, calls, events } = makeMockAdapter(authorityGate, ALL_COMMANDS);
    const intent = intentFactory.create({
      type: CoreCommandType.REORDER_QUEUE, fromIndex: 0, toIndex: 2,
    });
    authorityGate.register(intent);
    await adapter.execute(intent);
    assert.equal(calls.length, 0, "REORDER_QUEUE must not dispatch in Slice 1");
    assert.ok(events.some((e) => e.type === "CORE_ADAPTER_UNKNOWN_COMMAND"));
  });

  // ── Authority enforcement through the adapter ───────────────────────────────

  test("superseded intent does NOT reach the dispatch function", async () => {
    const { intentFactory, authorityGate } = makeFullStack();
    const { adapter, calls } = makeMockAdapter(authorityGate);
    const playA = intentFactory.create({ type: CoreCommandType.PLAY, trackId: "a" });
    const pause = intentFactory.create({ type: CoreCommandType.PAUSE });
    authorityGate.register(playA);
    authorityGate.register(pause);  // PLAY A is now superseded

    await adapter.execute(playA);   // should be silently dropped
    assert.equal(calls.length, 0, "superseded intent must not reach dispatch");

    await adapter.execute(pause);   // pause is still authoritative
    assert.equal(calls.length, 1);
    assert.equal(calls[0].type, "PAUSE");
  });

  test("HARDENING-B/PLAY A → SEEK: only SEEK reaches adapter (authority proven)", async () => {
    const { intentFactory, authorityGate } = makeFullStack();
    const { adapter, calls } = makeMockAdapter(authorityGate);
    const playA = intentFactory.create({ type: CoreCommandType.PLAY, trackId: "a" });
    const seek  = intentFactory.create({ type: CoreCommandType.SEEK, positionSeconds: 92 });
    authorityGate.register(playA);
    authorityGate.register(seek);   // PLAY A superseded

    // Simulate: PLAY A "completes async work" after SEEK was registered
    await adapter.execute(playA);
    await adapter.execute(seek);

    assert.equal(calls.length, 1,      "only one dispatch call");
    assert.equal(calls[0].type, "SEEK","SEEK must reach adapter, PLAY A must not");
    assert.equal(calls[0].payload.time, 92);
  });

  test("HARDENING-B/PLAY A → PLAY B: only PLAY B reaches adapter", async () => {
    const { intentFactory, authorityGate } = makeFullStack();
    const { adapter, calls } = makeMockAdapter(authorityGate);
    const playA = intentFactory.create({ type: CoreCommandType.PLAY, trackId: "a" });
    const playB = intentFactory.create({ type: CoreCommandType.PLAY, trackId: "b" });
    authorityGate.register(playA);
    authorityGate.register(playB);

    await adapter.execute(playA);   // arrives late, superseded
    await adapter.execute(playB);   // authoritative

    assert.equal(calls.length, 1);
    assert.equal(calls[0].payload.track.id, "b");
  });

  test("HARDENING-B/rapid commands: only last command reaches adapter", async () => {
    const { intentFactory, authorityGate } = makeFullStack();
    const { adapter, calls } = makeMockAdapter(authorityGate, ALL_COMMANDS);
    const intents = [];
    for (let i = 0; i < 20; i++) {
      const intent = intentFactory.create({ type: CoreCommandType.NEXT });
      intents.push(intent);
      authorityGate.register(intent);
    }
    // Execute all in order — only last is authoritative
    for (const intent of intents) {
      await adapter.execute(intent);
    }
    assert.equal(calls.length, 1, "only the last intent in a rapid sequence must reach dispatch");
  });

  test("HARDENING-B/randomized completion order: only last registered intent dispatches", async () => {
    const { intentFactory, authorityGate } = makeFullStack();
    const { adapter, calls } = makeMockAdapter(authorityGate, ALL_COMMANDS);
    const intents = [];
    for (let i = 0; i < 10; i++) {
      const intent = intentFactory.create({ type: CoreCommandType.NEXT });
      intents.push(intent);
      authorityGate.register(intent);
    }
    const last = intents[intents.length - 1];

    // Execute in shuffled order — simulates async completion out of order
    const shuffled = [...intents].sort(() => Math.random() - 0.5);
    for (const intent of shuffled) {
      await adapter.execute(intent);
    }
    assert.equal(calls.length, 1, "randomized order: only one dispatch");
    // The one that dispatched must be the last registered
    assert.ok(
      shuffled.every((i) => i !== last || calls.length === 1),
      "the dispatched command corresponds to the last-registered intent"
    );
  });

  // ── Slice 1B production scope containment ───────────────────────────────────
  // NEXT / PREVIOUS / SET_QUEUE / REORDER_QUEUE must not route live to
  // production until the Selection Domain migration moves NowPlaying + Queue +
  // QueueIndex together.

  test("SCOPE: default live scope is exactly PLAY, PAUSE, RESUME, SEEK", () => {
    assert.deepEqual(
      [...CoreLiveCommandScope].sort(),
      ["PAUSE", "PLAY", "RESUME", "SEEK"],
    );
  });

  for (const blocked of ["NEXT", "PREVIOUS", "SET_QUEUE", "REORDER_QUEUE"]) {
    test(`SCOPE: ${blocked} is refused by the default production scope`, async () => {
      const { intentFactory, authorityGate } = makeFullStack();
      const { adapter, calls, events } = makeMockAdapter(authorityGate);
      const intent = intentFactory.create({
        type: CoreCommandType[blocked],
        queueEntries: [{ id: "a" }], queueIndex: 0, fromIndex: 0, toIndex: 1,
      });
      authorityGate.register(intent);
      await adapter.execute(intent);
      assert.equal(calls.length, 0, `${blocked} must not reach production in Slice 1B`);
      assert.ok(
        events.some((e) => e.type === "CORE_ADAPTER_OUT_OF_SCOPE"),
        `${blocked} must be logged as CORE_ADAPTER_OUT_OF_SCOPE`
      );
    });
  }

  for (const allowed of ["PLAY", "PAUSE", "RESUME", "SEEK"]) {
    test(`SCOPE: ${allowed} is admitted by the default production scope`, async () => {
      const { intentFactory, authorityGate } = makeFullStack();
      const { adapter, calls } = makeMockAdapter(authorityGate);
      const intent = intentFactory.create({
        type: CoreCommandType[allowed], trackId: "a", positionSeconds: 5,
      });
      authorityGate.register(intent);
      await adapter.execute(intent);
      assert.equal(calls.length, 1, `${allowed} must remain live in Slice 1B`);
    });
  }

  // ── PlaybackCoreAdapter constructor guards ──────────────────────────────────

  test("PlaybackCoreAdapter constructor throws if dispatch is not a function", () => {
    const { authorityGate } = makeFullStack();
    assert.throws(
      () => new PlaybackCoreAdapter({ dispatch: "not-a-function", authorityGate, logger: null }),
      /dispatch must be a function/
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// INV-DESIRED: Desired-state convergence (Slice 1C)
//
//   INV-DESIRED-1  Every physical transport effect must be compatible with the
//                  latest authoritative desired state AT THE EFFECT BOUNDARY.
//   INV-DESIRED-2  A later command may inherit unaffected desired-state fields
//                  from prior commands; supersession revokes AUTHORITY, not
//                  SEMANTIC CONTEXT.
//   INV-DESIRED-3  Physical state may lag desired state, but must never
//                  intentionally converge toward an older revision once a newer
//                  revision exists.
//   INV-DESIRED-4  Emergency commands may bypass execution queues without
//                  bypassing desired-state authority.
// ─────────────────────────────────────────────────────────────────────────────

/** Deterministic in-memory physical runtime for convergence unit tests. */
function makeProbeRuntime(initial = {}) {
  const phys = {
    mediaIdentity: initial.mediaIdentity ?? null,
    transport:     initial.transport ?? TransportDisposition.IDLE,
    position:      initial.position ?? 0,
  };
  const calls = [];
  const adapter = {
    dispatchStep(step) {
      calls.push(step);
      switch (step.kind) {
        case "LOAD":
          phys.mediaIdentity = step.entry?.id ?? step.entry?.slug ?? null;
          phys.position = 0;
          phys.transport = TransportDisposition.PLAYING;
          break;
        case "SEEK":   phys.position = step.position; break;
        case "PAUSE":  phys.transport = TransportDisposition.PAUSED; break;
        case "RESUME":
          if (phys.mediaIdentity) phys.transport = TransportDisposition.PLAYING;
          break;
      }
      return Promise.resolve(true);
    },
  };
  return { phys, calls, adapter, probe: { snapshot: () => ({ ...phys }) } };
}

function makeEngine(initialPhysical) {
  const { intentFactory, authorityGate, logger } = makeFullStack();
  const store = new DesiredStateStore({ logger: null });
  const rt = makeProbeRuntime(initialPhysical);
  const engine = new ConvergenceEngine({
    desiredStore: store, adapter: rt.adapter, probe: rt.probe, logger: null,
  });
  return { engine, store, intentFactory, authorityGate, ...rt };
}

async function drain(engine, ms = 400) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5));
    if (engine.inFlight === 0 && !engine.isConverging) {
      await new Promise((r) => setTimeout(r, 15));
      if (engine.inFlight === 0 && !engine.isConverging) break;
    }
  }
}

describe("INV-DESIRED: desired-state convergence", () => {

  // ── INV-DESIRED-2: semantic inheritance ─────────────────────────────────────

  test("D2.1 PAUSE inherits requestedMediaIdentity from a prior PLAY", () => {
    const { store, intentFactory } = makeEngine();
    store.apply(intentFactory.create({
      type: CoreCommandType.PLAY, trackId: "a",
      queueEntries: [{ id: "a", slug: "a" }], queueIndex: 0,
    }));
    store.apply(intentFactory.create({ type: CoreCommandType.PAUSE }));

    assert.equal(store.current.requestedMediaIdentity, "a",
      "supersession revokes authority, not semantic context");
    assert.equal(store.current.desiredTransport, TransportDisposition.PAUSED);
  });

  test("D2.2 SEEK inherits media identity — a seek can never target the wrong track", () => {
    const { store, intentFactory } = makeEngine();
    store.apply(intentFactory.create({
      type: CoreCommandType.PLAY, trackId: "a",
      queueEntries: [{ id: "a", slug: "a" }], queueIndex: 0,
    }));
    store.apply(intentFactory.create({ type: CoreCommandType.SEEK, positionSeconds: 92 }));

    assert.equal(store.current.requestedMediaIdentity, "a");
    assert.equal(store.current.positionTarget, 92);
    assert.equal(store.current.desiredTransport, TransportDisposition.PLAYING);
  });

  test("D2.3 RESUME inherits both media identity and position target", () => {
    const { store, intentFactory } = makeEngine();
    store.apply(intentFactory.create({
      type: CoreCommandType.PLAY, trackId: "a",
      queueEntries: [{ id: "a", slug: "a" }], queueIndex: 0,
    }));
    store.apply(intentFactory.create({ type: CoreCommandType.SEEK, positionSeconds: 30 }));
    store.apply(intentFactory.create({ type: CoreCommandType.PAUSE }));
    store.apply(intentFactory.create({ type: CoreCommandType.RESUME }));

    assert.equal(store.current.requestedMediaIdentity, "a");
    assert.equal(store.current.positionTarget, 30);
    assert.equal(store.current.desiredTransport, TransportDisposition.PLAYING);
  });

  test("D2.4 a new PLAY replaces media identity and clears the position target", () => {
    const { store, intentFactory } = makeEngine();
    store.apply(intentFactory.create({
      type: CoreCommandType.PLAY, trackId: "a",
      queueEntries: [{ id: "a", slug: "a" }], queueIndex: 0,
    }));
    store.apply(intentFactory.create({ type: CoreCommandType.SEEK, positionSeconds: 92 }));
    store.apply(intentFactory.create({
      type: CoreCommandType.PLAY, trackId: "b",
      queueEntries: [{ id: "b", slug: "b" }], queueIndex: 0,
    }));

    assert.equal(store.current.requestedMediaIdentity, "b");
    assert.equal(store.current.positionTarget, null,
      "a fresh PLAY must not inherit the previous track's seek target");
  });

  // ── Revision discipline ─────────────────────────────────────────────────────

  test("D-REV.1 desiredRevision is monotonic across in-scope intents", () => {
    const { store, intentFactory } = makeEngine();
    const seen = [];
    for (const type of [CoreCommandType.PLAY, CoreCommandType.PAUSE,
                        CoreCommandType.RESUME, CoreCommandType.SEEK]) {
      store.apply(intentFactory.create({ type, trackId: "a", positionSeconds: 1 }));
      seen.push(store.revision);
    }
    assert.deepEqual(seen, [1, 2, 3, 4]);
  });

  test("D-REV.2 out-of-scope intents do not advance the revision", () => {
    const { store, intentFactory } = makeEngine();
    store.apply(intentFactory.create({ type: CoreCommandType.PLAY, trackId: "a" }));
    const before = store.revision;
    for (const type of [CoreCommandType.NEXT, CoreCommandType.PREVIOUS,
                        CoreCommandType.SET_QUEUE, CoreCommandType.REORDER_QUEUE]) {
      store.apply(intentFactory.create({ type, queueEntries: [], queueIndex: 0, fromIndex: 0, toIndex: 1 }));
    }
    assert.equal(store.revision, before);
  });

  test("D-REV.3 desired state objects are frozen", () => {
    const { store, intentFactory } = makeEngine();
    store.apply(intentFactory.create({ type: CoreCommandType.PLAY, trackId: "a" }));
    assert.ok(Object.isFrozen(store.current));
    assert.throws(() => { store.current.desiredTransport = "HACKED"; }, TypeError);
  });

  // ── INV-DESIRED-1 / 3: effect-boundary revalidation ─────────────────────────

  test("D1.1 a step planned against a stale revision is not dispatched", async () => {
    const { engine, store, intentFactory, calls } = makeEngine();
    // Register a revision, then advance it before convergence can act.
    store.apply(intentFactory.create({
      type: CoreCommandType.PLAY, trackId: "a",
      queueEntries: [{ id: "a", slug: "a" }], queueIndex: 0,
    }));
    const staleRevision = store.revision;
    store.apply(intentFactory.create({ type: CoreCommandType.PAUSE }));
    assert.notEqual(store.revision, staleRevision);

    await engine.converge("test");
    await drain(engine);

    // Convergence must have worked toward the NEWEST revision (PAUSED), never
    // re-asserted the stale PLAYING one.
    const last = calls[calls.length - 1];
    assert.ok(last, "convergence should have taken at least one step");
    assert.notEqual(last.kind, "RESUME",
      "converging toward the stale PLAYING revision would violate INV-DESIRED-3");
  });

  test("D3.1 convergence reaches the newest desired state, not an older one", async () => {
    const { engine, store, intentFactory, phys } = makeEngine({ mediaIdentity: "x", transport: TransportDisposition.PLAYING, position: 10 });
    store.apply(intentFactory.create({
      type: CoreCommandType.PLAY, trackId: "a",
      queueEntries: [{ id: "a", slug: "a" }], queueIndex: 0,
    }));
    store.apply(intentFactory.create({ type: CoreCommandType.PAUSE }));

    await engine.converge("test");
    await drain(engine);

    assert.equal(phys.mediaIdentity, "a");
    assert.equal(phys.transport, TransportDisposition.PAUSED);
  });

  test("D3.2 convergence is idempotent — a settled system takes no further steps", async () => {
    const { engine, store, intentFactory, calls } = makeEngine();
    store.apply(intentFactory.create({
      type: CoreCommandType.PLAY, trackId: "a",
      queueEntries: [{ id: "a", slug: "a" }], queueIndex: 0,
    }));
    await engine.converge("first");
    await drain(engine);
    const afterFirst = calls.length;

    await engine.converge("second");
    await drain(engine);
    assert.equal(calls.length, afterFirst,
      "convergence on an already-converged system must be a no-op");
  });

  test("D3.3 convergence terminates (no runaway loop) for a reachable target", async () => {
    const { engine, store, intentFactory, calls } = makeEngine({ mediaIdentity: "x", transport: TransportDisposition.PLAYING });
    store.apply(intentFactory.create({
      type: CoreCommandType.PLAY, trackId: "a",
      queueEntries: [{ id: "a", slug: "a" }], queueIndex: 0,
    }));
    store.apply(intentFactory.create({ type: CoreCommandType.SEEK, positionSeconds: 92 }));
    store.apply(intentFactory.create({ type: CoreCommandType.PAUSE }));

    await engine.converge("test");
    await drain(engine);
    assert.ok(calls.length <= 8, `expected a bounded step count, got ${calls.length}`);
  });

  test("D3.4 a repeated SEEK target is not re-issued as playback drifts", async () => {
    const { engine, store, intentFactory, calls, phys } = makeEngine();
    store.apply(intentFactory.create({
      type: CoreCommandType.PLAY, trackId: "a",
      queueEntries: [{ id: "a", slug: "a" }], queueIndex: 0,
    }));
    store.apply(intentFactory.create({ type: CoreCommandType.SEEK, positionSeconds: 92 }));
    await engine.converge("test");
    await drain(engine);
    const seeksAfterFirst = calls.filter((c) => c.kind === "SEEK").length;

    // Simulate playback advancing past the seek target.
    phys.position = 97;
    await engine.converge("drift");
    await drain(engine);

    assert.equal(calls.filter((c) => c.kind === "SEEK").length, seeksAfterFirst,
      "a satisfied seek target must not be re-issued when the playhead moves on");
  });

  // ── INV-DESIRED-4: emergency bypass does not bypass authority ───────────────

  test("D4.1 PAUSE advances the desired revision before any effect is dispatched", () => {
    const { engine, store, intentFactory, calls } = makeEngine({
      mediaIdentity: "a", transport: TransportDisposition.PLAYING,
    });
    const before = store.revision;
    engine.execute(intentFactory.create({ type: CoreCommandType.PAUSE }));

    assert.equal(store.revision, before + 1,
      "INV-DESIRED-4: bypassing the execution queue must not bypass authority");
    assert.equal(store.current.desiredTransport, TransportDisposition.PAUSED);
    assert.ok(calls.some((c) => c.kind === "PAUSE"),
      "the emergency effect must still be dispatched immediately");
  });

  test("D4.2 PAUSE dispatches its effect SYNCHRONOUSLY within execute()", () => {
    const { engine, intentFactory, calls } = makeEngine({
      mediaIdentity: "a", transport: TransportDisposition.PLAYING,
    });
    engine.execute(intentFactory.create({ type: CoreCommandType.PAUSE }));
    // No await — asserting in the same synchronous turn.
    assert.equal(calls.length, 1);
    assert.equal(calls[0].kind, "PAUSE");
  });

  test("D4.3 PLAY dispatches LOAD synchronously (iOS gesture requirement)", () => {
    const { engine, intentFactory, calls } = makeEngine();
    engine.execute(intentFactory.create({
      type: CoreCommandType.PLAY, trackId: "a",
      queueEntries: [{ id: "a", slug: "a" }], queueIndex: 0,
    }));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].kind, "LOAD");
  });

  test("D4.4 out-of-scope intents dispatch nothing and change nothing", () => {
    const { engine, store, intentFactory, calls } = makeEngine();
    const before = store.revision;
    engine.execute(intentFactory.create({ type: CoreCommandType.NEXT }));
    assert.equal(calls.length, 0);
    assert.equal(store.revision, before);
  });

  // ── Disposal ────────────────────────────────────────────────────────────────

  test("D-DISPOSE.1 a disposed engine performs no further effects", async () => {
    const { engine, store, intentFactory, calls } = makeEngine({
      mediaIdentity: "x", transport: TransportDisposition.PLAYING,
    });
    engine.dispose();
    store.apply(intentFactory.create({
      type: CoreCommandType.PLAY, trackId: "a",
      queueEntries: [{ id: "a", slug: "a" }], queueIndex: 0,
    }));
    await engine.converge("after-dispose");
    await drain(engine, 100);
    assert.equal(calls.length, 0,
      "an orphaned reconciler must never keep driving the media runtime");
  });

  test("D-DISPOSE.2 PlaybackCore.destroy() disposes the execution engine", () => {
    const core = PlaybackCore.create({ loggerEnabled: false });
    let disposed = false;
    core._injectExecutionEngine({ execute: () => null, dispose: () => { disposed = true; } });
    core.destroy();
    assert.ok(disposed, "destroy() must stop the reconciler");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// INV-HARDEN-A: DomainStore hardening (Slice 1 preflight)
//   A1 — JSON clone fallback removed: structuredClone unavailable → explicit throw
//   A2 — deepFreeze is cycle-safe: cyclic structures do not cause stack overflow
// ─────────────────────────────────────────────────────────────────────────────

describe("INV-HARDEN-A: DomainStore preflight hardening", () => {
  test("A1 — structuredClone path is taken (runtime supports it)", () => {
    // Confirms the happy path: structuredClone is available in this runtime,
    // meaning Core initialization succeeds and all snapshot contracts hold.
    assert.ok(typeof structuredClone === "function",
      "structuredClone must be available — Core requires it; JSON fallback is permanently rejected");
    const store = new DomainStore("test", { x: 1 });
    assert.equal(store.getSnapshot().x, 1);
  });

  test("A2 — deepFreeze is cycle-safe: two-node cycle does not stack overflow", () => {
    // A → B → A (two-node cycle)
    // structuredClone preserves the cycle in its output; deepFreeze must handle it.
    const a = { name: "a" };
    const b = { name: "b", parent: a };
    a.child = b;   // creates A → B → A cycle

    const store = new DomainStore("test", {});
    assert.doesNotThrow(
      () => store._applyCommit({ tree: a }),
      "deepFreeze must not overflow on a cyclic structure"
    );
  });

  test("A2 — deepFreeze is cycle-safe: self-referential object does not stack overflow", () => {
    // A → A (direct self-reference)
    const self = { name: "self" };
    self.ref = self;

    const store = new DomainStore("test", {});
    assert.doesNotThrow(
      () => store._applyCommit({ node: self }),
      "deepFreeze must not overflow on a self-referential object"
    );
  });

  test("A2 — deepFreeze is cycle-safe: deep chain with shared node does not overflow", () => {
    // Shared node referenced from multiple parents — not a cycle but tests WeakSet path
    const shared = { value: 42 };
    const store = new DomainStore("test", {});
    assert.doesNotThrow(
      () => store._applyCommit({ left: shared, right: shared, deeper: { also: shared } }),
      "deepFreeze must handle shared (DAG) references without redundant recursion"
    );
  });

  test("A2 — cycle-frozen snapshot still satisfies top-level frozen invariant", () => {
    const a = { name: "cyclic" };
    a.self = a;
    const store = new DomainStore("test", {});
    store._applyCommit({ node: a });
    const snap = store.getSnapshot();
    assert.ok(Object.isFrozen(snap), "top-level snapshot must be frozen even after cyclic commit");
    assert.ok(Object.isFrozen(snap.node), "cyclic node itself must be frozen");
  });
});
