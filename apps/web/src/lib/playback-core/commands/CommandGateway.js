/**
 * CommandGateway — the internal bridge from PlaybackPort calls to the
 * IntentFactory + AuthorityGate + execution pipeline.
 *
 * Call chain (locked by architecture spec):
 *   UI / LegacyAdapter
 *     → PlaybackPort.play() / pause() / etc.
 *       → CommandGateway.dispatch(commandType, payload)
 *         → IntentFactory.create(payload)
 *           → AuthorityGate.register(intent)       ← supersedes all prior intents
 *             → ExecutionEngine.execute(intent)     ← Slice 1+ only
 *               → CommitGate.propose(...)           ← only if still authoritative
 *
 * In Slice 0 the execution engine is a stub that only logs and returns null.
 * No actual playback changes occur through this path yet.
 *
 * Key invariant (locked):
 *   CommandGateway registers the intent with AuthorityGate BEFORE dispatching
 *   execution. This means every new command immediately supersedes all prior
 *   intents at the authority layer — even if execution hasn't started.
 *
 * The intent is immutable (Object.freeze) from the moment it leaves IntentFactory.
 * CommandGateway never mutates it. It only passes it forward.
 */

import { DiagnosticEventType } from "../types/index.js";

export class CommandGateway {
  #intentFactory;
  #authorityGate;
  #logger;
  #executionEngine;   // null in Slice 0; injected in Slice 1+

  /**
   * @param {object} deps
   * @param {import('../intents/IntentFactory.js').IntentFactory}       deps.intentFactory
   * @param {import('../authority/AuthorityGate.js').AuthorityGate}     deps.authorityGate
   * @param {import('../diagnostics/CoreLogger.js').CoreLogger}         deps.logger
   * @param {object|null} [deps.executionEngine]  - null until Slice 1
   */
  constructor({ intentFactory, authorityGate, logger, executionEngine = null }) {
    this.#intentFactory   = intentFactory;
    this.#authorityGate   = authorityGate;
    this.#logger          = logger;
    this.#executionEngine = executionEngine;
  }

  /**
   * Dispatch a command through the full intent pipeline.
   *
   * @param {string} commandType    - CoreCommandType constant
   * @param {object} [payload]      - command-specific payload fields
   * @param {string} [source]       - initiator label (default: "user")
   * @returns {import('../intents/IntentFactory.js').PlaybackIntent} the created intent
   */
  dispatch(commandType, payload = {}, source = "user") {
    // Step 1: create a frozen intent
    const intent = this.#intentFactory.create({
      type: commandType,
      source,
      ...payload,
    });

    this.#logger?.emit({
      type:     DiagnosticEventType.INTENT_CREATED,
      intentId: intent.intentId,
      sequence: intent.sequence,
      commandType,
      source,
    });

    // Step 2: register authority — all prior intents are superseded NOW
    this.#authorityGate.register(intent);

    this.#logger?.emit({
      type:     DiagnosticEventType.INTENT_AUTHORITY_GRANTED,
      intentId: intent.intentId,
      sequence: intent.sequence,
    });

    // Step 3: execution (stub in Slice 0)
    if (this.#executionEngine) {
      this.#logger?.emit({
        type:     DiagnosticEventType.INTENT_EXECUTION_START,
        intentId: intent.intentId,
      });
      try {
        const result = this.#executionEngine.execute(intent);
        this.#logger?.emit({
          type:     DiagnosticEventType.INTENT_EXECUTION_COMPLETE,
          intentId: intent.intentId,
          result,
        });
      } catch (err) {
        this.#logger?.emit({
          type:     DiagnosticEventType.INTENT_EXECUTION_ERROR,
          intentId: intent.intentId,
          error:    err?.message,
        });
      }
    }

    return intent;
  }

  /**
   * Inject the execution engine after construction.
   * Called by PlaybackCore during Slice 1 wiring.
   *
   * @param {object} engine
   */
  setExecutionEngine(engine) {
    this.#executionEngine = engine;
  }
}
