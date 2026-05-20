# Pricing, Gifting & Lyrics Audit

**Date:** 2026-05-19  
**Repos:** `artist-platform` (storefront), `2MRRW-Control-System` (release management)  
**Branch:** `dev` (artist-platform)

## Summary

| Area | Status |
|------|--------|
| `priceInCents` / `pricingTier` / `giftingEnabled` on releases | **Missing** (naming in codebase: `price_cents` / `priceCents`) |
| Control System release write APIs | Metadata/media/publish; **no commerce persistence** before this work |
| Storefront pricing display | **Hardcoded** in `page.js`; CS adapters exist but unused on main page |
| Gift flow | **Admin gift links** + redeem; no per-release `giftingEnabled` |
| Lyrics | Storage + `lyrics_text` / assets in CS; **no timed LRC UI** on storefront |

---

## artist-platform

### Commerce (`src/lib/commerce/`)

| File | Exists | Gap |
|------|--------|-----|
| `catalog.js` | Static `PRODUCT_CATALOG` with `price_cents` | Not tied to CS releases |
| `resolve-cart.js` | Charges DB `price_cents` | No `pricingTier` |
| `entitlements.js` | `library_items`, vault helpers | Slug-based; no release-id bridge |
| `fulfill-purchase.js` | Stripe → purchases + grants | Vault/collector helpers not wired |
| `vault-entitlements.js`, `collector-ownerships.js` | Defined | **Never called** from webhook |

**DB:** `products.price_cents` (001); gifts in 003/005; no release table.

### Release read path

- `src/lib/control-system/releases.js` — maps `priceCents`, `priceLabel`, `productSlug`, `lyricsAssetId`
- Hooks: `src/hooks/releases/*` — **not used** by `src/app/page.js`

### Storefront pricing render

```
page.js hardcoded price → cart (client) → create-payment-intent → resolveCartLines (DB price_cents)
```

**Risk:** Display price can diverge from charged amount.

### Vault / library

- `/api/library`, `/api/account/state`, `/api/vault/*` — functional
- Main page uses hardcoded exclusives, not vault API

### Lyrics

- Manifest `.lrc` paths in `storage/`
- CS: `lyricsAssetId`, `lyrics_text` on tracks
- **No** LRC parser or lyrics panel in player

### Gifting UI

- `/gift/[token]`, `/api/gifts/redeem`, `/api/admin/gifts`
- Library shows `source === "gift"`
- **No** fan purchase-to-gift or per-release toggle

---

## 2MRRW-Control-System

### UI

- `CreatorReleaseSystem.tsx` — “Pricing & Stores” checklist is **placeholder**
- `ReleaseForms.tsx` — no price/gift fields (prior to implementation)
- `Shop()` — stub

### APIs

- `PATCH .../metadata` — title, genres, schedule; no pricing
- Publish — `releases` + `tracks` + `media_assets`; **no `products` upsert**
- `GET /api/releases` — `priceCents` only if `products.grants` link exists

### Sync

- `markSyncDirty` + SSE — refetch signals, not commerce payload push
- artist-platform refetches public release APIs

---

## Implementation targets (Phase 1+)

1. **Schema:** `releases.price_in_cents`, `pricing_tier`, `gifting_enabled`, nullable deluxe/bundle/override hooks; `tracks.lyrics_mode` (`static`|`timed`).
2. **Validation:** single 299–799¢; ep/album 799–5000¢.
3. **Control:** metadata API + publish persistence + product upsert on publish.
4. **artist-platform:** `products.metadata` commerce flags; `gift_transactions` table; adapter maps release-level pricing.
5. **Wire hooks** into storefront (follow-up; out of scope for minimal pass).

---

## Recommended next steps

1. Merge pricing schema/API on `dev`; run Supabase migrations in both projects.
2. Wire `useSingles` / `useAlbums` on storefront `page.js` for `priceLabel` / `productSlug`.
3. Call `grantVaultPassEntitlement` from fulfillment for vault SKUs.
4. Add lyrics panel (static text first, timed LRC second).
5. Promotion: `dev` → `main`, tag `foundation-stable-v4`.
