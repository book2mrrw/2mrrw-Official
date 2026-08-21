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

export class PlaybackCore {
  #sequencer;
  #ownershipRegistry;
  #commandGateway;
  #commitGate;
  #port;
  #legacyAdapter;
  #reactAdapter;
  #logger;
  #destroyed = false;

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

    const port          = new PlaybackPort(commandGateway);
    const legacyAdapter = new LegacyPlaybackAdapter({ stores, ownershipRegistry });
    const reactAdapter  = new ReactPlaybackAdapter(stores);

    return new PlaybackCore({
      sequencer,
      ownershipRegistry,
      commandGateway,
      commitGate,
      port,
      legacyAdapter,
      reactAdapter,
      logger,
    });
  }

  // ─── Public surface ────────────────────────────────────────────────────────

  get port()          { this.#assertAlive(); return this.#port; }
  get legacyAdapter() { this.#assertAlive(); return this.#legacyAdapter; }
  get reactAdapter()  { this.#assertAlive(); return this.#reactAdapter; }
  get logger()        { return this.#logger; }
  get sessionEpoch()  { return this.#sequencer.sessionEpoch; }

  /**
   * Tear down the Core instance.
   * After destroy(), all port calls throw. Logger events still drain.
   */
  destroy() {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#logger.emitCoreDestroyed({ sessionEpoch: this.#sequencer.sessionEpoch });
  }

  // ─── Internal — Slice 1+ wiring only ──────────────────────────────────────

  /**
   * Inject the execution engine once the real engine is ready.
   * Called by Slice 1 wiring. Not part of the public API.
   *
   * @param {object} engine
   */
  _injectExecutionEngine(engine) {
    this.#commandGateway.setExecutionEngine(engine);
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

  // ─── Private ──────────────────────────────────────────────────────────────

  #assertAlive() {
    if (this.#destroyed) {
      throw new Error("[PlaybackCore] This Core instance has been destroyed. Create a new one.");
    }
  }
}
