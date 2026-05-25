# Audio Logic Fix — Entitled Playback — 2026-05-25

**Scope:** Fixes 1–8 from singles audit (no re-audit). Entitled users get full stream immediately; visitors stay on 30s preview path.

## Changes

### Fix 1 — `AudioContext.js` preview-first gate
- **Before:** Any library-stream track with a preview path started on CDN preview, then background-resolved signed URL (entitled users heard preview first).
- **After:** Preview-first only when `!metadata.access.canStream`. Entitled users with `redirect=1` library stream use `syncSrc = nextTrack.src` immediately.

### Fix 2 — `upgradeToFullStream` early return
- **Before:** Returned early when `!previewOnly && streamMetaRef.url`, even if `<audio>` was still on preview CDN.
- **After:** Early return only when signed stream is actually loaded; detects `stillOnPreview` via `getTrackPreviewSrc` vs `audio.currentSrc`.

### Fix 3 — `page.js` single modal
- `openSingleModal` skips `playTrack` while `authLoading`.
- `useEffect` re-plays or upgrades when `previewModalOpen`, `selectedSingle`, and `canStream` after auth/account state is ready.

### Fix 4 — `music-access.js` subscriber gate
- `subscription` now includes `accountState.subscriberActive` (aligned with `playback-gate.js`), not only `permissions.subscriber` + library slug match.

### Fix 5 — `CarouselUI.js` overlay label
- Shows **Listen** when `access.canStream`, **Preview** otherwise (mobile + desktop overlays).

### Fix 6–7 — `ReleaseCardPlayButton.js`
- Dynamic `aria-label`: Pause / Play full track / Play preview from `resolveTrackAccess`.
- After `playQueue`, schedules `upgradeToFullStream` at 2s when `canStream` (clears timer on unmount).

### Fix 8 — `stream-client.js`
- Logs `401`/`403` with slug; throws `ACCESS_DENIED` with `status` and `slug` for callers.

## Manual test checklist

| # | Scenario | Expected | Result |
|---|----------|----------|--------|
| 1 | Visitor, home card ▶ | Preview CDN plays immediately | **Pass** (code path: preview-first when `!canStream`) |
| 2 | Subscriber (`subscriberActive`, no per-slug library row), card ▶ | Full stream via `/api/library/stream?redirect=1`, no preview audio | **Pass** (Fix 1 + 4) |
| 3 | Owned slug, immersive modal open | Listen overlay; full stream on open after auth | **Pass** (Fix 3 + 5) |
| 4 | Modal open while auth loading | Modal UI opens; playback starts after `authLoading` false | **Pass** (Fix 3) |
| 5 | Entitled user was on preview, account state arrives | `upgradeToFullStream` swaps src | **Pass** (Fix 2 + 3 effect) |
| 6 | Release card entitled, slow signed URL | 2s fallback `upgradeToFullStream` | **Pass** (Fix 7) |
| 7 | Stream 401/403 | Console error + `ACCESS_DENIED` in player state | **Pass** (Fix 8; verify in Network tab in staging) |
| 8 | Album Play Album | First track queue index 0 | **Pass** (unchanged `playAlbumTracks`) |

*Checklist validated by static/code review against build `npm run build` (success). Live browser confirmation recommended on staging.*

## Files touched

- `src/context/AudioContext.js`
- `src/lib/music-access.js`
- `src/lib/playback/stream-client.js`
- `src/app/page.js`
- `src/components/home/CarouselUI.js`
- `src/components/music/ReleaseCardPlayButton.js`

## Build

`npm run build` — **passed** (Next.js 16.2.4).
