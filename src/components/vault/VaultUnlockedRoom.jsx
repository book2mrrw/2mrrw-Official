"use client";

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

      <div className="vault-unlocked-shelf" aria-label="Vault shelves">
        {sections.map((item) => (
          <article
            key={item.slug || item.id}
            className={`vault-unlocked-object${item.metadata?.glowEffect || item.feature ? " vault-unlocked-object--glow" : ""}`}
            data-media={item.mediaType || item.behavior || "mixed"}
          >
            <div className="vault-unlocked-object__spine" aria-hidden />
            {item.cover ? (
              <img src={item.cover} alt="" className="vault-unlocked-object__cover" loading="lazy" />
            ) : (
              <div className="vault-unlocked-object__cover vault-unlocked-object__cover--placeholder" />
            )}
            <div className="vault-unlocked-object__meta">
              <span className="vault-unlocked-object__category">{item.category}</span>
              <strong>{item.title}</strong>
              {item.metadata?.audioQualityBadge ? (
                <span className="vault-unlocked-object__badge">{item.metadata.audioQualityBadge}</span>
              ) : null}
            </div>
            {item.mediaType === "audio" && item.contentUrl ? (
              <div className="vault-unlocked-object__overlay vault-unlocked-object__overlay--audio">
                <span>Audio diary</span>
              </div>
            ) : null}
            {item.metadata?.isDropItem ? (
              <div className="vault-unlocked-object__overlay vault-unlocked-object__overlay--promo">
                <span>Surprise drop</span>
              </div>
            ) : null}
          </article>
        ))}
      </div>
    </div>
  );
}
