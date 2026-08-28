/**
 * PlaybackCoreAdapter — bridges PlaybackCore intents to the legacy
 * dispatchPlaybackCommand() serial queue.
 *
 * ARCHITECTURE POSITION (Slice 1):
 *   PlaybackPort → CommandGateway → IntentFactory → AuthorityGate
 *     → PlaybackCoreAdapter.execute(intent)
 *       → dispatchPlaybackCommand(type, payload)
 *         → [existing serial command queue]
 *           → executePlaybackCommand → handler bag
 *
 * OWNERSHIP (Slice 1 invariant — locked):
 *   PlaybackCore owns:  USER INTENT AUTHORITY (via AuthorityGate)
 *   PSM owns:           CANONICAL PHYSICAL/ORCHESTRATION TRANSPORT STATE
 *   These own different truths. Dual canonical state is explicitly prohibited.
 *   PSM remains canonical writer. Core does NOT commit to Transport domain.
 *
 * HARDENING-B (open — must prove with real adapter):
 *   The interleaving tests in invariants.test.js prove authority semantics.
 *   Physical transport correctness (PLAY A → SEEK 92 → A at 92s) must be
 *   separately proven once this adapter runs against the real media runtime.
 *
 * INJECTION MODEL:
 *   dispatchPlaybackCommand is injected as `dispatch` — never imported at module
 *   level. This keeps the adapter testable in plain Node.js and ensures the
 *   production wiring is explicit and auditable.
 *
 * COMMAND MAPPING (locked):
 *   CoreCommandType.PLAY        → PLAY_TRACK   { track, options }
 *   CoreCommandType.PAUSE       → PAUSE        {}
 *   CoreCommandType.RESUME      → RESUME       {}
 *   CoreCommandType.SEEK        → SEEK         { time: positionSeconds }
 *   CoreCommandType.NEXT        → NEXT_TRACK   {}
 *   CoreCommandType.PREVIOUS    → PREV_TRACK   {}
 *   CoreCommandType.SET_QUEUE   → PLAY_QUEUE   { tracks, startIndex }
 *   CoreCommandType.REORDER_QUEUE → (deferred to Slice 2 — no handler yet)
 */

import { CoreLiveCommandScope } from "../types/index.js";
import { PhysicalEffectAuthorityMode } from "../../audio/physical-effect-authority.js";

export class PlaybackCoreAdapter {
  #dispatch;
  #authorityGate;
  #logger;
  #liveScope;
  #effectAuthority;

  /**
   * @param {object} deps
   * @param {(type: string, payload: object) => Promise<any>} deps.dispatch
   *   The dispatchPlaybackCommand function (or a test double). Injected — never
   *   imported at module level so this class remains Node-testable.
   * @param {import('../authority/AuthorityGate.js').AuthorityGate} deps.authorityGate
   * @param {import('../diagnostics/CoreLogger.js').CoreLogger}     deps.logger
   * @param {Set<string>} [deps.liveScope]
   *   Command types routed LIVE to production. Defaults to CoreLiveCommandScope
   *   (PLAY/PAUSE/RESUME/SEEK). Anything mapped but outside this set is refused
   *   with CORE_ADAPTER_OUT_OF_SCOPE and never reaches the dispatcher.
   */
  constructor({ dispatch, authorityGate, logger, effectAuthority = null, liveScope = CoreLiveCommandScope }) {
    if (typeof dispatch !== "function") {
      throw new TypeError("[PlaybackCoreAdapter] dispatch must be a function. " +
        "Pass dispatchPlaybackCommand from @/lib/playback/command-dispatcher (production) " +
        "or a test double (tests).");
    }
    this.#dispatch   = dispatch;
    this.#authorityGate = authorityGate;
    this.#logger     = logger;
    this.#liveScope  = liveScope;
    this.#effectAuthority = effectAuthority;
  }

  /**
   * Execute a Core intent by dispatching the equivalent legacy command.
   *
   * Called by CommandGateway after AuthorityGate.register(). The authority
   * check here is a SECOND gate — the first is in AuthorityGate at registration
   * time. This second check guards against rapid EMERGENCY_BYPASS_COMMANDS
   * (PAUSE/STOP) that bypass the serial queue and can arrive after a later
   * serial-queue command was registered but before it runs.
   *
   * @param {import('../intents/IntentFactory.js').PlaybackIntent} intent
   * @returns {Promise<any>}
   */
  execute(intent) {
    if (!this.#authorityGate.isAuthoritative(intent)) {
      this.#logger?.emit({
        type: "CORE_ADAPTER_SKIPPED_SUPERSEDED",
        intentId: intent.intentId,
        sequence: intent.sequence,
      });
      return Promise.resolve(null);
    }

    // Slice 1B production scope gate. The mapping below is permanent contract
    // infrastructure for all eight command types, but only the live scope is
    // routed to production. NEXT / PREVIOUS / SET_QUEUE / REORDER_QUEUE stay
    // dormant until the Selection Domain migration moves NowPlaying + Queue +
    // QueueIndex together. Refusing here (rather than never mapping) keeps the
    // contract testable while guaranteeing no live traffic escapes scope.
    if (!this.#liveScope.has(intent.type)) {
      this.#logger?.emit({
        type: "CORE_ADAPTER_OUT_OF_SCOPE",
        commandType: intent.type,
        intentId: intent.intentId,
        sequence: intent.sequence,
      });
      return Promise.resolve(null);
    }

    const command = PlaybackCoreAdapter.#mapIntent(intent);
    if (!command) {
      this.#logger?.emit({
        type: "CORE_ADAPTER_UNKNOWN_COMMAND",
        commandType: intent.type,
        intentId: intent.intentId,
      });
      return Promise.resolve(null);
    }

    this.#logger?.emit({
      type: "CORE_ADAPTER_DISPATCH",
      commandType: command.type,
      intentId: intent.intentId,
      sequence: intent.sequence,
    });

    return Promise.resolve(this.#dispatch(command.type, command.payload));
  }

  /**
   * Dispatch a ConvergenceEngine step to the legacy pipeline.
   *
   * This is the ONLY place that knows legacy command names and payload shapes for
   * the Slice 1C convergence path. The ConvergenceEngine decides WHAT should
   * happen; this method knows HOW to say it.
   *
   * Note the SEEK payload key: the legacy executor reads `payload.time`
   * (command-executor.js:77), never `positionSeconds`.
   *
   * @param {{kind: string, entry?: object, position?: number, resumePolicy?: string}} step
   * @returns {Promise<any>}
   */
  dispatchStep(step, authority) {
    const audibleEffectContext = this.#effectAuthority
      ? {
          effectAuthorityMode: PhysicalEffectAuthorityMode.CORE,
          effectGuardRequired: true,
          effectAuthority: authority,
          canApplyEffect: (candidate, effect) =>
            this.#effectAuthority.canApplyEffect(candidate, effect),
        }
      : {};
    switch (step.kind) {
      case "LOAD":
        return Promise.resolve(this.#dispatch("PLAY_TRACK", {
          track: step.entry,
          options: {
            ...(step.options || {}),
            resumePolicy: step.resumePolicy ?? step.options?.resumePolicy,
            ...audibleEffectContext,
          },
        }, { effectAuthorityMode: PhysicalEffectAuthorityMode.CORE }));
      case "SEEK":
        return Promise.resolve(this.#dispatch(
          "SEEK",
          { time: step.position },
          { effectAuthorityMode: PhysicalEffectAuthorityMode.CORE },
        ));
      case "PAUSE":
        return Promise.resolve(this.#dispatch(
          "PAUSE",
          {},
          { effectAuthorityMode: PhysicalEffectAuthorityMode.CORE },
        ));
      case "RESUME":
        return Promise.resolve(this.#dispatch(
          "RESUME",
          audibleEffectContext,
          { effectAuthorityMode: PhysicalEffectAuthorityMode.CORE },
        ));
      default:
        this.#logger?.emit({ type: "CORE_ADAPTER_UNKNOWN_COMMAND", commandType: step.kind });
        return Promise.resolve(null);
    }
  }

  /**
   * Map a Core PlaybackIntent to { type, payload } for dispatchPlaybackCommand.
   * Returns null for unhandled/deferred command types.
   *
   * SEEK payload note: the legacy executor reads `command.payload.time`,
   * NOT `positionSeconds`. The mapping is explicit here so grep for `.time`
   * finds both the adapter and the executor.
   */
  static #mapIntent(intent) {
    switch (intent.type) {
      case "PLAY": {
        const track =
          intent.queueEntries?.[intent.queueIndex ?? 0] ??
          (intent.trackId ? { id: intent.trackId, slug: intent.trackId } : null);
        return {
          type: "PLAY_TRACK",
          payload: { track, options: { resumePolicy: intent.resumePolicy } },
        };
      }
      case "PAUSE":
        return { type: "PAUSE", payload: {} };
      case "RESUME":
        return { type: "RESUME", payload: {} };
      case "SEEK":
        return { type: "SEEK", payload: { time: intent.positionSeconds } };
      case "NEXT":
        return { type: "NEXT_TRACK", payload: {} };
      case "PREVIOUS":
        return { type: "PREV_TRACK", payload: {} };
      case "SET_QUEUE":
        return {
          type: "PLAY_QUEUE",
          payload: {
            tracks: intent.queueEntries ?? [],
            startIndex: intent.queueIndex ?? 0,
          },
        };
      case "REORDER_QUEUE":
        // No handler in Slice 1 — deferred to Slice 2.
        // The intent is logged as UNKNOWN_COMMAND above.
        return null;
      default:
        return null;
    }
  }
}
