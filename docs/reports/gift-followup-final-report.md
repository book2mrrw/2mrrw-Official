# Gift Follow-up Final Report

**Date:** 2026-05-24  
**Base context:** commit `acd019a` / prior `gift-followup-0fc712c`  
**Workspace:** `/Users/recharge/artist-platform`

---

## 1. Live seed against Supabase

**Command:** `node scripts/seed-products.mjs` (reads `.env.local`, service role — not committed)

| Metric | Result |
|--------|--------|
| Upserted rows | **20** |
| Catalog slugs `active: true` | **20 / 20** |
| Total `active: true` in `products` | **21** |

**Mismatches logged:**

- `vault-pass` is an extra active product not in `PRODUCT_CATALOG` (21 total active vs 20 catalog).
- All 20 catalog slugs present and active after seed.
- No `cover_url` mismatches vs catalog after normalization (leading `/images/...`).

---

## 2. Normalize `cover_url` paths

**Files updated:**

- `src/lib/commerce/catalog.js` — all `cover_url` → `/images/...`; feature `preview_path` → `/audio/previews/...`
- `scripts/seed-products.mjs` — imports `PRODUCT_CATALOG` (inherits normalized paths)

**Before:** `images/singles/...` (no leading slash) in catalog; seed script had `/images/...` duplicate list.  
**After:** single source in catalog with leading slash; seed upserts match.

`catalogCoverUrl()` in `src/lib/media-urls.js` still strips leading slash for CDN resolution — compatible with `/images/...` storage.

---

## 3. Extend `gifts.item_type` CHECK

**Migration:** `supabase/migrations/20260524120000_gifts_item_type_check.sql`

Drops `gifts_item_type_check` and re-adds CHECK including:

`single`, `ep`, `album`, `deluxe`, `collector_card`, **`feature`**, **`merch`**, **`bundle`**, **`vinyl`**

**Code:**

- `src/lib/commerce/resolve-storefront-product.js` — `releaseTypeToGiftItemType()` maps `feature`, `merch`, `bundle`, `vinyl` to matching `item_type` (no feature→single workaround).
- `src/lib/gifts/send-gift.js` — removed inline workaround comment; uses mapper directly.

**Manual apply:** Run migration on production Supabase (CLI `supabase db push` or SQL editor). Not applied remotely in this session.

---

## 4. Remove `-digital` legacy fallback

**File:** `src/lib/commerce/resolve-storefront-product.js` (not repo root)

**Production query** (via seed script post-seed):

```sql
SELECT DISTINCT slug FROM products WHERE slug LIKE '%-digital';
```

**Result:** **(none)** — 0 rows

**Action taken:** Removed `-digital` candidate generation from `storefrontProductSlugCandidates()`. Kept `-vinyl` → base slug stripping only. No slug migration required.

---

## 5. Fix `@/` alias in `seed-products.mjs`

**Before:** Duplicated 20-row `CATALOG` array in script.  
**After:** `import { PRODUCT_CATALOG } from "../src/lib/commerce/catalog.js"` — removed dead `@/` re-exports from `catalog.js` so Node can load catalog without path alias.

Post-seed verification in script: active count, missing/extra slugs, `cover_url` diffs, `-digital` slug query.

---

## Build

`npm run build` — **PASSED** (Next.js 16.2.4)

---

## Artifacts

| Artifact | Path |
|----------|------|
| Report | `docs/reports/gift-followup-final-report.md` |
| Zip | `~/Downloads/gift-followup-final-20260524.zip` |

Zip contents: report, `scripts/seed-products.mjs`, `resolve-storefront-product.js`, `send-gift.js`, migration SQL.

---

## Open questions

1. **`vault-pass`:** Should it remain active outside catalog, be deactivated, or added to `PRODUCT_CATALOG`?
2. **Migration apply:** Confirm `20260524120000_gifts_item_type_check.sql` on production before sending gifts with `item_type` = `feature` | `merch` | `bundle` | `vinyl` (inserts will fail until CHECK is extended).
3. **`package.json` `"type": "module"`:** Node warns when importing `catalog.js` from `.mjs`; optional cleanup.
4. **E2E/docs references:** `scripts/stripe-purchase-manual-smoke.md` and `test-library-stream-e2e.mjs` still mention `hour-glass-digital` — update when those flows are next touched.
