# 06 — Ownership Preservation

Hybrid architecture must not weaken 2MRRW’s ownership model: **User + permissions**, not guest→subscriber ladder fiction.

---

## Authority chain (unchanged)

```mermaid
flowchart LR
  WH[Stripe webhook]
  SB[(Supabase source tables)]
  AS[/api/account/state]
  UI[AuthContext UI display]
  WH --> SB --> AS --> UI
```

**Rule:** UI never grants stream/download; it reflects server state — `platform-architecture.mdc`, `music-access.js`.

---

## Entitlement types vs asset layer

| Entitlement | Stream playback | Master download | Metadata authority |
|-------------|-----------------|-----------------|------------------|
| Purchase (`library_items`, entitlements) | Yes | Yes (token route) | `products` + purchase record |
| Subscription (active membership) | Yes digital catalog | No default | membership row |
| Collector card | Yes full digital catalog | Bundle-dependent | collector_cards + entitlements |
| Vault tier | Vault API only | If product includes download | `vault_content` |
| Admin | Yes | Yes | profile role |

Stream renditions **do not create** new entitlement types — they are delivery optimization under existing gates.

---

## Collector card guarantees

| Guarantee | Preservation mechanism |
|-----------|------------------------|
| Full-catalog listen | `userCanStreamProduct` unchanged; stream key only reduces bytes |
| Card verification integrity | `src/app/api/collector-card/verify/route.js`, `collector/cards/verify` — no change |
| Physical + digital narrative | Masters remain; marketing copy on bundles unchanged |
| NFC / activation flows | DB-driven; no R2 path coupling |

**Explicit:** Collector “ownership” messaging refers to **masters + artifacts**, not AAC files.

---

## Vault guarantees

- Tier gating stays in `src/lib/vault/access.js` and vault media route.
- `preview_storage_path` vs `media_storage_path` duality preserved.
- Stream renditions optional for audio vault items — entitlement checks before sign.

---

## Purchase & gift flows

| Step | File | Hybrid impact |
|------|------|---------------|
| Checkout | `src/app/api/checkout/session/route.js` | None |
| Webhook grant | entitlements + `grantLibraryItems` | None |
| Library display | `useMusicLibrary.js`, `MyMusicTab.js` | None |
| Play | `resolvePlaybackSrc` | Uses stream at resolve layer only |
| Download token | `api/access/[token]` | **Master key only** |

---

## Metadata authority

| Field | Source of truth |
|-------|-----------------|
| Slug, title, price | `products` |
| Canonical folders | `canonical-catalog.js` + `products.storage_path` |
| Track listing | `catalog_tracks` / `tracks` |
| Stream key (proposed) | `media_assets` role `stream_audio` OR deterministic `streaming/…` path |

**Conflict resolution:** DB `storage_path` wins over canonical catalog for playback folder; catalog provides fallback (`resolve-playback-key.js` L192–214).

---

## Cache invalidation on ownership change

When entitlement revoked or product rotated:

- `invalidateStreamCacheForUser` — `stream-url-cache.js` L54–59
- `clearPlaybackKeyCache` — `resolve-playback-key.js` L174–177
- `clearMediaResolverCaches` — `cache-invalidation.js`

Add: invalidate stream rendition cache entries when master replaced (implementation).

---

## Anti-patterns (forbidden)

1. Client checks `localStorage` for “owned” to pick stream vs master.
2. Public ACL on `digital-assets/` masters.
3. Replacing purchase download with stream-only file.
4. Separate guest identity class with different resolver.

---

## Audit checklist (pre-deploy)

- [ ] Entitled fan without stream file falls back to master (no regression)
- [ ] Guest still cannot hit `library/stream` 200 without entitlement
- [ ] Purchase token still fetches master-sized asset
- [ ] Collector deactivate removes stream access same as today
