# React #185 Mobile Safari Fix Report

**Date:** 2026-05-26  
**Issue:** React error #185 (Maximum update depth exceeded) on iPhone Safari during CS cover hold / ambient updates.

## Bug 1 — `src/hooks/useCsCoverTransition.js`

**Status:** FIXED

- Added `lastDisplaySrcRef` and `lastDisplayTypeRef` initialized from current display targets.
- Replaced unconditional `setDisplaySrc` / `setDisplayType` on the stable-`csMode` path (former lines 28–31) with ref-guarded updates only when `targetSrc` / `targetType` actually change.
- Applied the same guarded pattern in the 200ms swap timer callback.

## Bug 2 — `src/components/ui/CoverArtCS.js`

**Status:** FIXED

- Removed derived `csMode = isLocked || csOpacity >= 1` from feeding `useCsCoverTransition`.
- Hook now uses engine `csMode` only (`lockedCsMode = csMode || isLocked` for backward compatibility).
- Hold preview is visual-only: base `CoverArt` layer stays on `originalSrc`; CS artwork renders in an absolute overlay with opacity from `csOpacity` (or full opacity when locked).
- Updated `PlayerArtwork.js` and `FloatingMainPlayer.js` to pass `csMode={csMode}` instead of `isLocked={csMode}`.

## Bug 3 — `src/components/audio/GlobalAudioPlayerBar.js`

**Status:** FIXED

- Added `ambientCoverUrlRef` at component top.
- Debounced all `setAmbientCoverUrl` calls in touch handlers (`touchStart`, `touchMove` cancel, `touchEnd` release) via ref equality on resolved URL.
- Applied the same ref guard in the track/csMode ambient `useEffect` (lines ~427–431).
- Removed `setAmbientCoverUrl` from the hold opacity RAF `onFrame` callback; CS ambient URL is set once when hold starts. RAF loop only drives `setCsHoldOpacity` (via `animateHoldOpacity`).

## Build status

**PASS** — `npm run build` (Next.js 16.2.4) completed successfully after changes.

## Deviations

- `CoverArtCS` retains optional `isLocked` prop as fallback (`lockedCsMode = csMode || isLocked`) so older call sites do not break; primary call sites now use `csMode`.
- Hold-preview overlay applies CS color grading (`saturate` / `brightness`) during fade, not only when locked (matches prior locked styling intent for the CS layer).
- Ambient URL debounce was also applied in the non-touch track/csMode `useEffect` (same ref pattern) for consistency with the fix spec.

## Files changed

- `src/hooks/useCsCoverTransition.js`
- `src/components/ui/CoverArtCS.js`
- `src/components/audio/GlobalAudioPlayerBar.js`
- `src/components/player/ImmersivePlayerEngine/PlayerArtwork.js`
- `src/components/player/ImmersivePlayerEngine/FloatingMainPlayer.js`
