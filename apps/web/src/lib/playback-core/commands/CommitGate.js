/**
 * CommitGate — the single write boundary for all canonical Core state.
 *
 * INVARIANTS (all locked, from architecture specification):
 *
 *   Invariant 1: A superseded playback intent can never mutate committed state.
 *                Enforced by: AuthorityGate.isAuthoritative() check before write.
 *
 *   Invariant 2: At most one canonical writer per domain at any instant.
 *                Enforced by: DomainOwnershipRegistry.isOwnedByCore() check before write.
 *
 *   Invariant 3: Deck B handoff may commit only if authorizing intent is still
 *                authoritative at the exact commit boundary.
 *                Same as Invariant 1 — both paths go through CommitGate.propose().
 *
 * Only CommitGate calls DomainStore._applyCommit(). No other code may call it.
 *
 * The validation pipeline is extensible: pass additional validators to the
 * constructor; each receives (intent, domain, snapshot, context) and returns
 * a CommitRejectionReason or null.
 *
 * All rejections are logged via CoreLogger before returning. Proposing code must
 * inspect the result and decide whether the rejection is terminal or retryable.
 */

import { CommitRejectionReason } from "../types/index.js";

/**
 * @typedef {object} CommitResult
 * @property {boolean} accepted
 * @property {string|null} rejectionReason  - CommitRejectionReason or null if accepted
 * @property {string} intentId
 * @property {string} domain
 * @property {number} newVersion            - DomainStore version after commit (if accepted)
 */

export class CommitGate {
  #authorityGate;
  #ownershipRegistry;
  #stores;
  #logger;
  #extraValidators;

  /**
   * @param {object} deps
   * @param {import('../authority/AuthorityGate.js').AuthorityGate}           deps.authorityGate
   * @param {import('../ownership/DomainOwnershipRegistry.js').DomainOwnershipRegistry} deps.ownershipRegistry
   * @param {Map<string, import('../state/DomainStore.js').DomainStore>}       deps.stores
   * @param {import('../diagnostics/CoreLogger.js').CoreLogger}                deps.logger
   * @param {Array<Function>} [deps.extraValidators]  - (intent, domain, snapshot, ctx) => reason|null
   */
  constructor({ authorityGate, ownershipRegistry, stores, logger, extraValidators = [] }) {
    this.#authorityGate    = authorityGate;
    this.#ownershipRegistry = ownershipRegistry;
    this.#stores           = stores;
    this.#logger           = logger;
    this.#extraValidators  = extraValidators;
  }

  /**
   * Propose a state commit. Validates authority + domain ownership + any extra
   * validators before applying. Atomic: either the snapshot is committed or
   * nothing changes.
   *
   * @param {object} params
   * @param {import('../intents/IntentFactory.js').PlaybackIntent} params.intent
   * @param {string} params.storeKey   - StoreKey constant identifying target store
   * @param {string} params.domain     - Domain constant identifying ownership domain
   * @param {object} params.snapshot   - new state to commit
   * @param {object} [params.context]  - optional metadata for extra validators
   * @returns {CommitResult}
   */
  propose({ intent, storeKey, domain, snapshot, context = {} }) {
    // ── Gate 1: authority ────────────────────────────────────────────────────
    if (!this.#authorityGate.isAuthoritative(intent)) {
      const reason = CommitRejectionReason.SUPERSEDED;
      this.#logger?.emit({
        type:        "INTENT_COMMIT_REJECTED",
        intentId:    intent?.intentId ?? "unknown",
        domain,
        storeKey,
        reason,
        authoritativeIntentId: this.#authorityGate.authoritativeIntentId,
      });
      return { accepted: false, rejectionReason: reason, intentId: intent?.intentId ?? "unknown", domain, newVersion: -1 };
    }

    // ── Gate 2: domain ownership ──────────────────────────────────────────────
    if (!this.#ownershipRegistry.isOwnedByCore(domain)) {
      const reason = CommitRejectionReason.DOMAIN_NOT_OWNED_BY_CORE;
      this.#logger?.emit({
        type:     "INTENT_COMMIT_REJECTED",
        intentId: intent.intentId,
        domain,
        storeKey,
        reason,
      });
      return { accepted: false, rejectionReason: reason, intentId: intent.intentId, domain, newVersion: -1 };
    }

    // ── Gate 3: target store must exist ──────────────────────────────────────
    const store = this.#stores.get(storeKey);
    if (!store) {
      const reason = CommitRejectionReason.INVALID_INTENT;
      this.#logger?.emit({
        type:     "INTENT_COMMIT_REJECTED",
        intentId: intent.intentId,
        domain,
        storeKey,
        reason,
        detail:   `unknown storeKey: ${storeKey}`,
      });
      return { accepted: false, rejectionReason: reason, intentId: intent.intentId, domain, newVersion: -1 };
    }

    // ── Gate 4: extensible extra validators ───────────────────────────────────
    for (const validate of this.#extraValidators) {
      const reason = validate(intent, domain, snapshot, context);
      if (reason != null) {
        this.#logger?.emit({
          type:     "INTENT_COMMIT_REJECTED",
          intentId: intent.intentId,
          domain,
          storeKey,
          reason,
        });
        return { accepted: false, rejectionReason: reason, intentId: intent.intentId, domain, newVersion: -1 };
      }
    }

    // ── All gates pass — commit ───────────────────────────────────────────────
    store._applyCommit(snapshot);

    this.#logger?.emit({
      type:       "INTENT_COMMIT_ACCEPTED",
      intentId:   intent.intentId,
      domain,
      storeKey,
      newVersion: store.version,
    });

    return { accepted: true, rejectionReason: null, intentId: intent.intentId, domain, newVersion: store.version };
  }
}
