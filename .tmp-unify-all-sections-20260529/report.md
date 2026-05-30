# Unify playback across Singles, Features, Albums, Mixtapes & EPs

**Date:** 2026-05-29  
**Base commit:** `85e7ccd` (feature preview/stream path fixes)  
**Working tree commit hash (no new commit):** `85e7ccd57797369c31262d9d0d0619c6490d90b7`  
**Build:** `npm run build` — passed

## Prompt requirements (checklist)

| # | Requirement | Status |
|---|-------------|--------|
| 1 | Folder-listing resolution (filename-agnostic) for all release types | Confirmed — `resolveAudio` / `discoverFileByExtensions` lists entity folder; removed features→singles audio fallback |
| 2 | Unified play pipeline (`playTrack` / `resolvePlaybackSrc`) | Confirmed — all sections converge; album tracks now always use album product `slug` + `trackSlug` query param |
| 3 | `normalizeReleaseType` maps single/features/album/ep consistently; no silent `singles` default | Fixed — missing/unknown types log `[normalizeReleaseType]` and return `null` |
| 4 | Same entitlement logic (`resolveTrackAccess`, `userCanStreamProduct`) | Confirmed — unchanged; shared via `music-access.js` |
| 5 | Same preview/stream APIs (`/api/media/preview`, `/api/library/stream`) | Confirmed — no section-specific routes |
| 6 | `npm run build` passes | Passed |
| 7 | Commit / push / Vercel prod | Not requested by prompt — skipped |

## Canonical R2 paths (all sections)

| Section | Full audio | Preview |
|---------|------------|---------|
| Singles | `digital-assets/singles/{slug}/` | `previews/singles/{slug}/` |
| Features | `digital-assets/features/{slug}/` | `previews/features/{slug}/` |
| Albums | `digital-assets/albums/{slug}/{trackSlug}/` | `previews/albums/{slug}/{trackSlug}/` |
| Mixtapes/EPs | `digital-assets/mixtapes-and-eps/{slug}/{trackSlug}/` | `previews/mixtapes-and-eps/{slug}/{trackSlug}/` |

Singles and features: flat slug folder (no track nesting). Albums and mixtapes/EPs: track-level nesting.

## Files changed

- `src/lib/media/utils/normalize-release-type.js`
- `src/lib/playback/resolve-playback-key.js`
- `src/lib/music-playback.js`
- `src/lib/media/media-availability.js`
- `src/lib/media/canonical-paths.js`
- `src/lib/media/canonical-catalog.js`
- `src/lib/media/entity-resolver.js`
- `src/components/home/catalogMedia.js`

## Before / after by section

### Singles (reference — no pipeline change)

| Aspect | Before | After |
|--------|--------|-------|
| Entry | `CarouselUI` → `ReleaseCardActions` → `toPlaybackTrack` → `playQueue` / modal `playCanonicalCatalogItem` | Same |
| Full audio | `/api/library/stream?slug={singleSlug}` → `resolvePlaybackKey` → folder list in `digital-assets/singles/{slug}/` | Same |
| Guest preview | `catalogPreviewAudioUrl` → `/api/media/preview?folder=previews/singles/{slug}/` | Same |
| releaseType inference | Unknown types could default to `singles` | Unknown/missing logs error; no silent mis-route |

### Features

| Aspect | Before | After |
|--------|--------|-------|
| Entry | `FeaturesRail` → same `ReleaseCardActions` / `playCanonicalCatalogItem` as singles | Same (already unified on 85e7ccd) |
| Full audio folder | `digital-assets/features/{slug}/` with **fallback** list in `singles/` if miss | **Only** `features/{slug}/` (R2 folders corrected) |
| Preview | Entity folder `previews/features/{slug}/` via discovery API | Same |
| releaseType | Could fall through to `singles` in `inferProductReleaseType` | Storage/metadata inference; logs if unknown |

### Albums

| Aspect | Before | After |
|--------|--------|-------|
| Entry | `openAlbumModal` → `playAlbumTracks` → `albumTracksForPlayback` → `playQueue` | Same |
| Stream slug | Track slug used when track existed in singles/features catalog lookup (wrong product for `/api/library/stream`) | **Always** album release `slug`; `trackSlug` passed for nested folder |
| Full audio path | `digital-assets/albums/{albumSlug}/{trackSlug}/` via `resolveStoragePath` + folder list | Same (now reachable with correct slug + trackSlug) |
| Preview | `/api/media/preview` on `previews/albums/{albumSlug}/{trackSlug}/` | Same |

### Mixtapes & EPs

| Aspect | Before | After |
|--------|--------|-------|
| releaseType | `ep` / `mixtape` → `mixtapes-and-eps` via aliases | Same; null if unmapped (logged) |
| Paths | `digital-assets/mixtapes-and-eps/{slug}/{trackSlug}/` | Same |
| Playback | Same album pipeline with `release_type` on track items | Same + explicit `release_type` on track playback items |

## Key code changes (summary)

1. **`normalizeReleaseType`** — returns `null` + `console.error` for missing/unknown input (was silent `"singles"`).
2. **`inferProductReleaseType`** — returns `null` + error log when type cannot be inferred (was `"singles"`).
3. **`discoverAudioInFolder`** — removed features→singles R2 fallback.
4. **`media-availability`** — removed features→singles fallback; unavailable when release type unknown.
5. **`resolveAlbumTrackStreamSlug`** — always album product slug (fixes entitled stream for album tracks that share a single slug).
6. **`canonical-paths`** — path builders no-op when release type is null (with error log).

## Verification

- `npm run build` — success (Next.js 16.2.4)
- No changes to `AudioContext`, entitlement webhooks, or storefront UI layout
- No commit, push, or `vercel --prod` (not in prompt scope)

## Remaining risks

- Callers passing invalid `release_type` will see `null` paths until catalog/DB metadata is fixed (intentional surfacing).
- Legacy flat preview filenames still supported via `/api/media/preview?legacy=` during migration.
