"use client";

import { VaultUnlockedShelf } from "./VaultUnlockedShelf";

/**
 * Additive unlocked Vault room shell — does not modify locked-state UI elsewhere.
 */
export function VaultUnlockedRoom({ sections = [], pricing, vaultAccess }) {
  if (!sections.length) {
    return (
      <div className="vault-unlocked-room vault-unlocked-room--empty">
        <p>Premium Vault shelves are syncing. Check back shortly.</p>
      </div>
    );
  }

  return (
    <div className="vault-unlocked-room" data-tier={vaultAccess?.tier || "vault_pass"}>
      <header className="vault-unlocked-room__header">
        <p className="vault-unlocked-room__eyebrow">Premium Vault · Unlocked</p>
        <h3>Archive shelves</h3>
        {pricing ? (
          <p className="vault-unlocked-room__pricing">
            {pricing.cardOwnerFree
              ? "Collector access — no Vault Pass charge"
              : pricing.hasSubscriber
                ? `Subscriber Vault Pass ${pricing.displaySubscriber}`
                : `Vault Pass ${pricing.displayRegular}`}
          </p>
        ) : null}
      </header>

      <VaultUnlockedShelf sections={sections} />
    </div>
  );
}
