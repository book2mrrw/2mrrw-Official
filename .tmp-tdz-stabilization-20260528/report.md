# TDZ Stabilization Report — 2026-05-28

## Summary

Stabilized media dependency graph to eliminate TDZ/hydration crash risks from lib→component inversion and eager module-scope catalog initialization. Build passes; madge reports zero circular dependencies.

---

## Phase 1 — Cycles found

See [phase1-audit.md](./phase1-audit.md).

| ID | Chain | Severity | Status |
|----|-------|----------|--------|
| A | `music-playback` → `catalogMedia` (component) | HIGH | **Fixed** |
| B | `music-playback` → `canonical-catalog` → `canonical-paths` | MEDIUM | Acceptable (lazy index) |
| C | `commerce/catalog` top-level `getCanonicalProductRows()` | HIGH | **Fixed** (lazy) |
| D | `entity-resolver` → `storage/r2` | N/A server | Not in client playback path |
| E/F | AuthContext / AudioContext | Clean | No change needed |

**Madge:** `✔ No circular dependency found!` (326 files)

---

## Phase 2 — Files created/changed

### Created (layer 1–2)

| File | Purpose |
|------|---------|
| `src/lib/media/constants/release-types.js` | `RELEASE_TYPES`, `RELEASE_TYPE_ALIASES`, `RELEASE_FOLDER` — zero imports |
| `src/lib/media/constants/storage-domains.js` | `AUDIO_ROOT`, `IMAGE_ROOT`, `PREVIEW_ROOT`, `VIDEO_ROOT` |
| `src/lib/media/utils/normalize-release-type.js` | Pure `normalizeReleaseType` / `isKnownReleaseType` |
| `src/lib/media/r2-catalog-media.js` | `withR2CatalogMedia` extracted from component layer |

### Modified

| File | Change |
|------|--------|
| `src/lib/media/normalize-release-type.js` | Re-export barrel → constants + utils |
| `src/lib/media/canonical-paths.js` | Import storage domains + release types from constants |
| `src/lib/music-playback.js` | Import `withR2CatalogMedia` from lib, not `catalogMedia.js` |
| `src/components/home/catalogMedia.js` | Thin display wrapper; delegates URL resolution to lib |
| `src/lib/commerce/catalog.js` | Lazy `getProductCatalog()` — removed top-level `getCanonicalProductRows()` |
| `src/lib/commerce/resolve-storefront-product.js` | Use `getProductCatalog()` |
| `src/app/api/admin/seed-products/route.js` | Use `getProductCatalog()` |

### Constraints verified

- `canonical-catalog.js` — no playback/resolver/UI imports ✓
- `entity-resolver.js` — no catalogMedia/page.js imports ✓
- `music-playback.js` — no entity-resolver import ✓
- No barrel `index.js` in `media/` or `playback/` ✓

---

## Phase 3 — Top-level execution audit

Grep for forbidden module-scope calls:

| Pattern | Result |
|---------|--------|
| `resolvePlayableMedia(` | None at module scope |
| `resolveAudio(` | Only inside async functions (`media-availability.js`, `resolve-playback-key.js`) |
| `createQueue(` | None |
| `loadMetadata(` | None |

**Additional fix:** Removed `const CANONICAL_DIGITAL = getCanonicalProductRows()` from `commerce/catalog.js`.

---

## Phase 4–6 — Validation

### Build

```
npm run build → ✓ Compiled successfully
```

### Client bundle path check

| Path | Reaches `storage/r2.js`? | Reaches `entity-resolver`? |
|------|--------------------------|----------------------------|
| `AudioContext.js` → direct imports | via `media-urls` only (URL builder) | No |
| `AudioContext.js` → `music-playback` | N/A — no direct import | No |
| `music-playback.js` → deps | via `media-urls` (not entity-resolver) | **No** ✓ |
| `music-playback.js` → `catalogMedia` | **Removed** | No |

Note: `media-urls.js` imports `getPublicR2Url` for CDN URL construction — this is intentional and does not pull AWS SDK discovery paths used by `entity-resolver.js`.

### Hydration safety

- `AppAuthRoot` placeholder guard preserved (cd7bf9b)
- Auth readiness guards preserved (24f5f9a)
- No module-scope catalog/resolver execution on client boot path
- `availability-cache.js` remains client-safe (no R2/resolver imports)

---

## Validation checklist

- [x] `npm run build` passes
- [x] Madge zero circular deps
- [x] `music-playback` does not import `catalogMedia.js`
- [x] `music-playback` does not import `entity-resolver.js`
- [x] Layer-1 constants have zero imports
- [x] No top-level `getCanonicalProductRows()` at module load
- [x] Folder-authoritative paths preserved
- [x] Canonical catalog titles/slugs unchanged
- [x] Auth/OTP fixes untouched

---

## Before / after dependency diagram

**Before:** lib imported component; commerce catalog eager-init at import time.

**After:** Acyclic layered graph — constants → utils → paths/catalog → playback; component layer imports lib only.

```
BEFORE:  music-playback ──► catalogMedia (component) ──► canonical-paths
         commerce/catalog ──► getCanonicalProductRows() [TOP LEVEL]

AFTER:   music-playback ──► r2-catalog-media (lib)
         catalogMedia ──► r2-catalog-media (lib)
         canonical-paths ──► constants/* + utils/*
         commerce/catalog ──► getProductCatalog() [lazy on first call]
```
