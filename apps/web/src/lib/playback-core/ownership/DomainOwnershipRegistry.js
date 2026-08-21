/**
 * DomainOwnershipRegistry — explicit single-writer tracking per state domain.
 *
 * INVARIANT (locked):
 *   Every canonical state domain has exactly one owner at every instant.
 *   LEGACY and CORE must never be simultaneous writers.
 *
 * All domains start LEGACY. Ownership transfers to CORE as vertical slices
 * are migrated. Transfer is one-way: once a domain is CORE, it stays CORE.
 *
 * The CommitGate queries this registry before applying any commit to ensure
 * only Core-owned domains can be mutated through the Core commit path.
 * Legacy-owned domains remain exclusively under the legacy engine's authority.
 *
 * MIGRATION RULE (locked):
 *   LegacyPlaybackAdapter may read snapshots from both sides.
 *   It may NEVER write to Core-owned domains, and Core may NEVER write
 *   directly into legacy state. No mutable refs cross the seam.
 */

import { DomainOwner, Domain } from "../types/index.js";

export class DomainOwnershipRegistry {
  #owners;

  constructor() {
    // All domains start as LEGACY — production playback is unaffected.
    this.#owners = new Map([
      [Domain.TRANSPORT,         DomainOwner.LEGACY],
      [Domain.SELECTION,         DomainOwner.LEGACY],
      [Domain.CAPABILITY,        DomainOwner.LEGACY],
      [Domain.CONTINUITY,        DomainOwner.LEGACY],
      [Domain.MEDIA_PREPARATION, DomainOwner.LEGACY],
    ]);
  }

  /**
   * Returns the current owner of a domain.
   * Unknown domains default to LEGACY for safety.
   *
   * @param {string} domain - Domain constant
   * @returns {"LEGACY" | "CORE"}
   */
  getOwner(domain) {
    return this.#owners.get(domain) ?? DomainOwner.LEGACY;
  }

  /**
   * Transfer domain ownership to Core.
   * Idempotent if already CORE.
   * One-way: never call transferToLegacy — that path does not exist.
   *
   * @param {string} domain
   * @param {import('../diagnostics/CoreLogger.js').CoreLogger} [logger]
   */
  transferToCore(domain, logger) {
    const current = this.getOwner(domain);
    if (current === DomainOwner.CORE) return;
    this.#owners.set(domain, DomainOwner.CORE);
    logger?.emit({
      type:   "DOMAIN_OWNER_CHANGED",
      domain,
      from:   DomainOwner.LEGACY,
      to:     DomainOwner.CORE,
    });
  }

  /**
   * @param {string} domain
   * @returns {boolean}
   */
  isOwnedByCore(domain) {
    return this.getOwner(domain) === DomainOwner.CORE;
  }

  /**
   * Returns a plain-object snapshot of the current ownership table.
   * Useful for diagnostics and migration status reporting.
   *
   * @returns {Record<string, "LEGACY" | "CORE">}
   */
  getOwnershipMap() {
    return Object.fromEntries(this.#owners);
  }
}
