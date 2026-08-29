/**
 * PlaybackCore — top-level assembly for 2MRRW Playback Core.
 *
 * This is the one place where all Core components are wired together.
 * No other file constructs these components — they are injected here.
 *
 * LIFECYCLE:
 *   const core = PlaybackCore.create();
 *   core.port.play({ trackId: "...", ... });
 *   // ... later:
 *   core.destroy();
 *
 * ARCHITECTURE POSITION:
 *   PlaybackCore owns the IntentSequencer, which means it exclusively owns
 *   sessionEpoch. JWT/auth/session refresh NEVER reset the sessionEpoch.
 *   Only destroying and recreating PlaybackCore produces a new epoch.
 *   (Invariant 17 — locked.)
 *
 * In Slice 0:
 *   - All domain stores are initialized with empty/idle snapshots.
 *   - All domains are LEGACY-owned.
 *   - The execution engine is a stub (null); commands are accepted and tracked
 *     through the intent pipeline, but no playback state is driven by Core yet.
 *   - The legacy engine continues driving all playback unchanged.
 *
 * PUBLIC SURFACE (stable forever):
 *   core.port           — PlaybackPort (play/pause/resume/seek/next/previous/setQueue/reorderQueue)
 *   core.legacyAdapter  — LegacyPlaybackAdapter (read-only snapshots for migration)
 *   core.reactAdapter   — ReactPlaybackAdapter (useSyncExternalStore hooks)
 *   core.logger         — CoreLogger (diagnostic event subscription + history)
 *   core.sessionEpoch   — stable epoch string for this Core lifecycle
 *   core.destroy()      — tear down Core instance
 *
 * INTERNAL (used by Slice 1+ wiring only):
 *   core._injectExecutionEngine(engine)
 *   core._transferDomainToCore(domain)
 *   core._commitGate
 */

import { IntentSequencer }         from "../intents/IntentSequencer.js";
import { IntentFactory }           from "../intents/IntentFactory.js";
import { AuthorityGate }           from "../authority/AuthorityGate.js";
import { DomainOwnershipRegistry } from "../ownership/DomainOwnershipRegistry.js";
import { createDomainStores }      from "../state/createDomainStores.js";
import { CoreLogger }              from "../diagnostics/CoreLogger.js";
import { CommitGate }              from "../commands/CommitGate.js";
import { CommandGateway }          from "../commands/CommandGateway.js";
import { PlaybackPort }            from "../ports/PlaybackPort.js";
import { LegacyPlaybackAdapter }   from "../ports/LegacyPlaybackAdapter.js";
import { ReactPlaybackAdapter }    from "../adapters/ReactPlaybackAdapter.js";
import { DesiredStateStore }       from "../desired/DesiredStateStore.js";
import { CoreReadiness }           from "../types/index.js";
import { CoreEpoch }               from "../authority/CoreEpoch.js";
import { AudibleEffectAuthority }  from "../effects/AudibleEffectAuthority.js";
import { TransportAuthority }      from "../transport/TransportAuthority.js";
import { SelectionAuthority }      from "../selection/SelectionAuthority.js";
import { ContinuityAuthority }     from "../continuity/ContinuityAuthority.js";

export class PlaybackCore {
  #sequencer;
  #ownershipRegistry;
  #commandGateway;
  #commitGate;
  #port;
  #legacyAdapter;
  #reactAdapter;
  #logger;
  #authorityGate;
  #desiredStore;
  #coreEpoch;
  #effectAuthority;
  #transportAuthority;
  #selectionAuthority;
  #continuityAuthority;
  #disposeInstalledEffectGuard = null;
  #effectGuardInstalled = false;
  #executionEngine = null;
  #destroyed = false;
  #readiness = CoreReadiness.CONSTRUCTING;

  /**
   * Private constructor — use PlaybackCore.create() instead.
   */
  constructor(deps) {
    this.#sequencer         = deps.sequencer;
    this.#ownershipRegistry = deps.ownershipRegistry;
    this.#commandGateway    = deps.commandGateway;
    this.#commitGate        = deps.commitGate;
    this.#port              = deps.port;
    this.#legacyAdapter     = deps.legacyAdapter;
    this.#reactAdapter      = deps.reactAdapter;
    this.#logger            = deps.logger;
    this.#authorityGate     = deps.authorityGate;
    this.#desiredStore      = deps.desiredStore;
    this.#coreEpoch         = deps.coreEpoch;
    this.#effectAuthority   = deps.effectAuthority;
    this.#transportAuthority = deps.transportAuthority;
    this.#selectionAuthority = deps.selectionAuthority;
    this.#continuityAuthority = deps.continuityAuthority;

    this.#logger.emitCoreInitialized({ sessionEpoch: this.#sequencer.sessionEpoch });
  }

  /**
   * Factory — the only public way to instantiate PlaybackCore.
   *
   * @param {{ loggerEnabled?: boolean }} [opts]
   * @returns {PlaybackCore}
   */
  static create({ loggerEnabled = true } = {}) {
    const sequencer         = new IntentSequencer();
    const intentFactory     = new IntentFactory(sequencer);
    const authorityGate     = new AuthorityGate();
    const ownershipRegistry = new DomainOwnershipRegistry();
    const stores            = createDomainStores();
    const logger            = new CoreLogger({ enabled: loggerEnabled });

    const commitGate = new CommitGate({
      authorityGate,
      ownershipRegistry,
      stores,
      logger,
    });

    const commandGateway = new CommandGateway({
      intentFactory,
      authorityGate,
      logger,
      executionEngine: null,
    });

    const legacyAdapter = new LegacyPlaybackAdapter({ stores, ownershipRegistry });
    const reactAdapter  = new ReactPlaybackAdapter(stores);
    const desiredStore  = new DesiredStateStore({ logger });
    const coreEpoch = new CoreEpoch(sequencer.sessionEpoch);
    const effectAuthority = new AudibleEffectAuthority({
      coreEpoch,
      getDesiredState: () => desiredStore.current,
      logger,
    });
    const transportAuthority = new TransportAuthority({
      commitGate,
      authorityGate,
      desiredStore,
      coreEpoch,
      stores,
      logger,
    });

    // Selection gets its OWN AuthorityGate + CommitGate pair (sharing the same
    // stores/ownershipRegistry/logger) so an unrelated Selection action can
    // never supersede an in-flight Transport intent, or vice versa. See
    // SelectionAuthority.js's header for the full rationale.
    const selectionAuthorityGate = new AuthorityGate();
    const selectionCommitGate = new CommitGate({
      authorityGate: selectionAuthorityGate,
      ownershipRegistry,
      stores,
      logger,
    });
    const selectionAuthority = new SelectionAuthority({
      commitGate: selectionCommitGate,
      selectionAuthorityGate,
      coreEpoch,
      stores,
      logger,
    });

    // Continuity gets its own AuthorityGate + CommitGate pair too, for the
    // same reason Selection does — an unrelated continuity-candidate
    // validation must never supersede an in-flight Transport or Selection
    // intent. It holds a reference to selectionAuthority so it can delegate
    // (never re-implement) atomic Selection restoration.
    const continuityAuthorityGate = new AuthorityGate();
    const continuityCommitGate = new CommitGate({
      authorityGate: continuityAuthorityGate,
      ownershipRegistry,
      stores,
      logger,
    });
    const continuityAuthority = new ContinuityAuthority({
      commitGate: continuityCommitGate,
      continuityAuthorityGate,
      coreEpoch,
      stores,
      logger,
      selectionAuthority,
    });

    // Readiness accessor — closed over the PlaybackCore instance (assigned below).
    // The port calls this before accepting any command; before READY it throws
    // explicitly rather than silently dropping the command.
    let coreRef = null;
    const isReady = () => coreRef !== null && coreRef.readiness === CoreReadiness.READY;

    const port = new PlaybackPort(commandGateway, isReady);

    const core = new PlaybackCore({
      sequencer,
      ownershipRegistry,
      commandGateway,
      commitGate,
      port,
      legacyAdapter,
      reactAdapter,
      logger,
      authorityGate,
      desiredStore,
      coreEpoch,
      effectAuthority,
      transportAuthority,
      selectionAuthority,
      continuityAuthority,
    });
    coreRef = core;
    return core;
  }

  // ─── Public surface ────────────────────────────────────────────────────────

  get port()          { this.#assertAlive(); return this.#port; }
  get legacyAdapter() { this.#assertAlive(); return this.#legacyAdapter; }
  get reactAdapter()  { this.#assertAlive(); return this.#reactAdapter; }
  get logger()        { return this.#logger; }
  get sessionEpoch()  { return this.#sequencer.sessionEpoch; }
  get coreEpoch()     { return this.#coreEpoch.current; }
  /** Current readiness state — CONSTRUCTING until adapter injected, then READY, then DISPOSED. */
  get readiness()     { return this.#readiness; }

  /**
   * Tear down the Core instance.
   * After destroy(), all port calls throw. Logger events still drain.
   */
  destroy() {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#readiness = CoreReadiness.DISPOSED;
    // Stop the reconciler before anything else. A live ConvergenceEngine would
    // otherwise keep driving the shared media runtime toward this Core's stale
    // desired state after the Core itself is gone.
    this.#executionEngine?.dispose?.();
    this.#disposeInstalledEffectGuard?.();
    this.#disposeInstalledEffectGuard = null;
    this.#effectAuthority.dispose();
    this.#transportAuthority.destroy();
    this.#coreEpoch.dispose();
    this.#logger.emitCoreDestroyed({ sessionEpoch: this.#sequencer.sessionEpoch });
  }

  // ─── Internal — Slice 1+ wiring only ──────────────────────────────────────

  /**
   * Inject the execution engine and transition Core to READY.
   *
   * MUST be called synchronously before any public PlaybackPort command is
   * dispatched. The engine must be fully constructed — no lazy initialization,
   * no dynamic import, no async bridge. Wiring is deterministic.
   *
   * @param {import('../adapters/PlaybackCoreAdapter.js').PlaybackCoreAdapter} engine
   */
  _injectExecutionEngine(engine, { effectAuthority = null, disposeInstalledEffectGuard = null } = {}) {
    this.#assertAlive();
    if (effectAuthority !== this.#effectAuthority) {
      throw new Error(
        "[PlaybackCore] Physical effect guard is not installed. " +
        "Core cannot become READY without its exact effect-authority instance."
      );
    }
    if (typeof disposeInstalledEffectGuard !== "function") {
      throw new Error(
        "[PlaybackCore] Current-media effect guard is not installed. " +
        "Core cannot become READY without the session-wide recovery guard."
      );
    }
    this.#effectGuardInstalled = true;
    this.#disposeInstalledEffectGuard = disposeInstalledEffectGuard;
    this.#executionEngine = engine;
    this.#commandGateway.setExecutionEngine(engine);
    this.#readiness = CoreReadiness.READY;
    this.#logger.emitCoreReady({ sessionEpoch: this.#sequencer.sessionEpoch });
  }

  /**
   * Transfer a domain from LEGACY to CORE ownership.
   * Called during vertical slice migration. Not part of the public API.
   *
   * @param {string} domain - Domain constant
   */
  _transferDomainToCore(domain) {
    this.#ownershipRegistry.transferToCore(domain, this.#logger);
  }

  /**
   * Direct CommitGate access for execution engine.
   * Not part of the public API.
   */
  get _commitGate() { return this.#commitGate; }

  /**
   * The AuthorityGate this Core's CommandGateway registers intents against.
   * Exposed solely so the execution adapter can perform its second authority
   * check against the SAME gate — a different gate instance would silently
   * make the check meaningless. Not part of the public API.
   */
  get _authorityGate() { return this.#authorityGate; }
  get _effectAuthority() { return this.#effectAuthority; }
  get _transportAuthority() { return this.#transportAuthority; }
  get _selectionAuthority() { return this.#selectionAuthority; }
  get _continuityAuthority() { return this.#continuityAuthority; }
  get _ownershipMap() { return this.#ownershipRegistry.getOwnershipMap(); }
  get _effectGuardInstalled() { return this.#effectGuardInstalled; }

  /** Catastrophic recovery invalidates every token captured by the old runtime. */
  _rotateCoreEpoch(reason = "runtime-reset") {
    this.#assertAlive();
    const previousEpoch = this.#coreEpoch.current;
    const coreEpoch = this.#coreEpoch.rotate();
    this.#logger.emit({ type: "CORE_EPOCH_ROTATED", previousEpoch, coreEpoch, reason });
    return coreEpoch;
  }

  /**
   * Canonical DESIRED execution state store (Slice 1C).
   * Read freely for diagnostics; only the ConvergenceEngine should apply intents.
   */
  get desiredState() { return this.#desiredStore.current; }

  /** Internal handle for wiring the ConvergenceEngine. Not part of the public API. */
  get _desiredStore() { return this.#desiredStore; }

  /**
   * The injected execution engine (ConvergenceEngine in production).
   * Exposed for diagnostics and for tests that must await convergence settlement.
   * Not part of the public API.
   */
  get _executionEngine() { return this.#executionEngine; }

  // ─── Private ──────────────────────────────────────────────────────────────

  #assertAlive() {
    if (this.#destroyed) {
      throw new Error("[PlaybackCore] This Core instance has been destroyed. Create a new one.");
    }
  }
}
