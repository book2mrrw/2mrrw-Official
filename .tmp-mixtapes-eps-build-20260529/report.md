# Mixtapes & EPs UI build — 2026-05-29

**Repo:** `/Users/recharge/artist-platform`  
**Base commit:** `9b25e069b4bd7e12cf6857c2a489e810932970ef` (audit anchor)  
**Mode:** Part 2 implementation (UI)  
**Build:** `npm run build` — **PASS**

---

## Prompt requirements checklist

| # | Requirement | Status |
|---|-------------|--------|
| 1 | Storefront "Albums" label retained | Done |
| 2 | "Mixtapes & EPs" section under Albums (home) | Done — `LatestSinglesStyleRow` |
| 3 | Shows love-hz-vol-1, ad, tbh | Done — from `getStorefrontMixtapesAndEps()` |
| 4 | Clone Latest Singles row UI (160/200px cards, scroll snap, ReleaseCardActions) | Done — shared `LatestSinglesStyleRow` |
| 5 | My Music: Mixtapes category (ad, tbh) | Done |
| 6 | My Music: EPs category (love-hz-vol-1) | Done |
| 7 | mixtapes-and-eps release type (not recategorized as albums) | Done — `type: ep/mixtape`, storefront split |
| 8 | Canonical track objects + stream contract unchanged | Done — reuses existing pipeline |
| 9 | love-hz → love-hz-vol-1 everywhere in storefront data | Done — inline stale data removed |
| 10 | Remove three releases from Albums inline data | Done — `CANONICAL_TRUE_ALBUMS = []` |
| 11 | Empty audio folders render, non-playable, no throw | Done — existing `getPlayButtonState` / queue filter |
| 12 | Do not modify AudioContext / resolvePlaybackSrc | Done — no edits |
| 13 | npm run build passes | Done |
| 14 | Commit / push / vercel --prod | **Not requested** — skipped |

---

## Implementation summary

### Storefront (`page.js`)
- Albums hydrates from `getStorefrontAlbums()` (empty — reserved for future true albums).
- New **Mixtapes & EPs** home section uses shared singles-style row with cover art cards.
- Latest Singles row refactored to shared component (identical chrome/behavior).
- `catalogPlaybackLookup` includes canonical mixtape/EP releases with track objects.

### Canonical catalog (`canonical-catalog.js`)
- Split `CANONICAL_TRUE_ALBUMS` vs `CANONICAL_MIXTAPES_AND_EPS`.
- Added `getStorefrontMixtapesAndEps()` returning canonical track `{ slug, title, track_number }` objects.

### My Music
- `partitionLibraryByType` → `ownedMixtapes`, `ownedEps`, `ownedAlbums` (true albums only).
- `useMusicLibrary` exposes `ownedMixtapes` / `ownedEps`.
- `MyMusicTab` renders **Owned Mixtapes**, **Owned EPs**, **Owned Albums** under Purchased/Owned.

### DB migration
- Not required — existing migrations + `CANONICAL_TRACKS` already match R2 folder slugs/order (`verify-r2-entity-folders.mjs`).

---

## Files changed

| File | Change |
|------|--------|
| `src/components/home/LatestSinglesStyleRow.js` | **New** — shared Latest Singles row |
| `src/lib/media/canonical-catalog.js` | Split catalogs; `getStorefrontMixtapesAndEps()` |
| `src/lib/music-access.js` | `partitionLibraryByType` → mixtapes/EPs/albums |
| `src/hooks/useMusicLibrary.js` | `ownedMixtapes`, `ownedEps` |
| `src/components/music/MyMusicTab.js` | Mixtapes/EPs owned sections |
| `src/app/page.js` | Wire canonical data, new section, shared row |

**Commit:** None (prompt did not request)

---

## Zip

`/Users/recharge/Downloads/mixtapes-eps-build-20260529.zip`
