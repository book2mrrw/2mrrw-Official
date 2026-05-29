# TDZ / Circular Import Boot Fix — 2026-05-28

## 1. Circular chains found

### Primary boot hazard (introduced in 460dd72)

```
music-playback.js
  → media-availability.js
    → entity-resolver.js
      → storage/r2.js (S3Client top-level init)
    → @/components/home/catalogMedia.js (lib → UI import)
```

Not a strict ES cycle, but **client boot pulled the full server resolver graph** because `music-playback` imported `getCachedAvailability` from `media-availability.js`. ESM evaluates all top-level imports of a module — so AudioContext → music-playback dragged AWS R2 + entity discovery into the client bundle at load time, causing `ReferenceError: Cannot access uninitialized variable` in production (Safari/Vercel edge cases).

### Lib → component back-edge (TDZ risk)

```
media-availability.js → catalogMedia.js → canonical-paths.js
music-playback.js     → catalogMedia.js (for isUpcomingReleaseDate + withR2CatalogMedia)
```

`isUpcomingReleaseDate` lived in a UI module but was imported by server lib code — wrong layer boundary.

### Pre-existing (unchanged, not in media scope)

```
entitlements.js ↔ unified-entitlements.js
AudioContext.js ↔ useMediaEngine.js
AudioContext.js ↔ AudioPhase10Bridge.js
CoverArt.js ↔ ArtworkSkeleton.js
```

Madge reports **no cycles** within `src/lib/media/*` after fix.

## 2. Files causing TDZ

| File | Issue |
|------|-------|
| `src/lib/music-playback.js` | Imported `media-availability.js` on client playback path |
| `src/lib/media/media-availability.js` | Imported `catalogMedia.js`; bundled entity-resolver + R2 |
| `src/components/home/catalogMedia.js` | Hosted pure `isUpcomingReleaseDate` helper used by lib code |

## 3. Changes made

| Action | File |
|--------|------|
| **Created** | `src/lib/media/release-date.js` — pure `isUpcomingReleaseDate`, zero back-imports |
| **Created** | `src/lib/media/availability-cache.js` — in-memory cache only, client-safe |
| **Updated** | `src/lib/media/media-availability.js` — uses new modules; re-exports cache API |
| **Updated** | `src/lib/music-playback.js` — imports cache + release-date directly (not media-availability) |
| **Updated** | `src/components/home/catalogMedia.js` — re-exports `isUpcomingReleaseDate` from lib |
| **Updated** | `src/lib/media/cache-invalidation.js` — clears cache via `availability-cache.js` |

No playback logic, UI layout, or business rules changed — **import structure only**.

## 4. Build / boot confirmation

| Check | Result |
|-------|--------|
| `npm run build` | ✅ Pass |
| `npm run dev` | ✅ Ready in ~474ms, no module-load errors |
| `music-playback` → `entity-resolver` | ✅ Removed |
| `music-playback` → `media-availability` | ✅ Removed |
| `npx madge --circular src/lib/media` | ✅ No cycles |

## Diagram (before → after)

```
BEFORE (client boot):
AudioContext → music-playback → media-availability → entity-resolver → r2 (💥)

AFTER (client boot):
AudioContext → music-playback → availability-cache (✓)
                              → release-date (✓)
                              → catalogMedia (UI URLs only)
```
