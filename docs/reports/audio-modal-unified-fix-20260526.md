# Audio + Modal Unified Prompt v2 — Fix Report

**Date:** 2026-05-26  
**Build:** `npm run build` — pass  
**Reference commits:** `5b8f4fc`, `01c64a8`, `ff7953b`

## Summary

Most v2 spec items were already implemented in prior commits. This pass closed the remaining gaps: **pause on modal dismiss (v2 override)**, **sync `audio.play()` without await**, **subscriber gate alignment**, **page mini-player `nowPlaying` sync**, and **album modal dismiss pause**.

---

## Already fixed (prior commits — no change needed)

| Spec item | Status | Where |
|-----------|--------|--------|
| Preview CDN first; entitled `redirect=1` or background swap | Done | `AudioContext.playTrack`, `music-access.resolvePlaybackSrc` |
| 30s hard stop + `setPreviewEnded` + `preview:ended` | Done | `AudioContext` `timeupdate` / `ended` handlers |
| `openSingleModal` / `openFeatureModal` sync play in click; `modalPlaySlugRef` + auth replay `useEffect` | Done | `page.js` |
| Mode 1: `ReleaseCardPlayButton` → `playQueue`, no modal | Done | `ReleaseCardPlayButton.js` |
| Mode 2: cover → `ImmersivePreviewModal` + sync play | Done | `page.js` `openSingleModal` |
| Album: `openAlbumModal` → `playAlbumTracks` index 0 | Done | `page.js` |
| Immersive modal tree preserved (62/38, scene, floating player) | Done | `ImmersivePreviewModal` + immersive/* |
| `ReleaseCardPlayButton` preload preview on mount | Done | `useEffect` + `preloadTrack` |
| `PreviewPlayerControls` seek clamp to `PREVIEW_DISPLAY_CAP_SEC` | Done | `PreviewPlayerControls.js` |
| No second audio element / `setInterval` timers / THEMES catalog | Verified | Single `<audio>` in `AudioContext` |

Protected areas left untouched: AV IntersectionObserver pause, tab ambient (`page.js` ~808–817), `vault-audio.js`, `layout.js` GlobalAudioPlayerBar mount, `globals.css` 62/38, `AlbumTracklistSheet` stack.

---

## Changed in this pass

### `src/context/AudioContext.js`
- **`playTrack`:** Invoke `audio.play()` synchronously; handle promise with `.catch()` instead of `await audio.play()` before returning (preserves user-gesture chain for mobile).

### `src/lib/music-access.js`
- **Subscriber gate:** `subscription` now requires `subscriberActive` **and** `permissions.subscriber` **and** (library row or global subscriber). Removed standalone `accountState.subscriberActive` bypass without `permissions.subscriber`.

### `src/app/page.js`
- **`closeSingleModal` / `closeFeatureModal`:** Call `pause()` from `AudioContext` on dismiss (**v2 spec — audio stops on close**).
- **`closeAlbumModal`:** New helper; overlay / Close / post-cart dismiss calls `pause()`.
- **`nowPlaying`:** `useEffect` sets page mini-player state when card/library playback starts (`hasStarted` + `currentTrack`, excluding open immersive modals).

### Incidental (already in working tree, not spec-driven)
- `MusicAccessBadge.js` — badge color when `canStream`
- `ReleaseCardPlayButton.js` — pause button visual state
- `useCoverPalette.js` — scene CSS var aliases

---

## Deviations / intentional behavior

| Topic | v1 / old | v2 (this implementation) |
|-------|----------|---------------------------|
| Modal close | Audio could continue after closing immersive modal | **`pause()` on close** — single, feature, and album modal dismiss paths |
| Global vs page player | `GlobalAudioPlayerBar` uses `AudioContext` (`hasStarted`); page `nowPlaying` bar was never set | Page bar now syncs from `currentTrack` for card playback; layout bar unchanged |
| Album add-to-cart | Modal closed without pause | Uses `closeAlbumModal()` → pauses (consistent with v2 dismiss rule) |

---

## Files touched (git diff)

```
src/app/page.js
src/context/AudioContext.js
src/lib/music-access.js
src/components/music/MusicAccessBadge.js      (pre-existing WIP)
src/components/music/ReleaseCardPlayButton.js (pre-existing WIP)
src/hooks/useCoverPalette.js                  (pre-existing WIP)
```

---

## QA checklist

- [ ] **Card play (Mode 1):** Tap ▶ on home single card — audio starts, no modal, `GlobalAudioPlayerBar` appears.
- [ ] **Cover play (Mode 2):** Tap single card body — immersive modal opens, audio starts in same gesture.
- [ ] **Preview cap:** Guest / non-entitled — playback stops at 30s; scrub bar capped at 30s; preview-ended CTA in modal.
- [ ] **Modal close:** Close single/feature modal — audio **stops** (not background).
- [ ] **Album modal:** Open album → first track plays; close overlay — audio stops.
- [ ] **Auth deferral:** Open modal while `authLoading` — replay fires when account state ready (`modalPlaySlugRef`).
- [ ] **Subscriber gate:** User with `subscriberActive` but no `permissions.subscriber` — preview only, not full stream.
- [ ] **Entitled stream:** Subscriber with permission — `/api/library/stream?redirect=1` or background signed URL swap.
- [ ] **Page mini-player:** After card play, desktop/mobile `nowPlaying` bar shows title/cover.
- [ ] **AV tab:** Enter Audio/Visuals tab — existing intersection pause still works (unchanged).
- [ ] **Build:** `npm run build` passes.

---

## ZIP contents

`audio-modal-unified-fix-20260526.zip` — this report plus changed source files listed above.
