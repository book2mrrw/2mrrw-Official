# F2 / F4 correction — 2026-05-27

## Prompt asked

1. Revert over-additions from commit `627f3e7` (tap-to-play UI, auth-deferred play, gesture-resume flags, silent-graph detection).
2. **F2:** Cover-art tap calls `playTrack` synchronously in the same handler (no `authLoading` deferral, no second tap).
3. **F4:** On `visibilitychange` → visible, attempt `audio.play()` immediately when state says playing but element is paused.
4. Keep F1/F3/F5 from `627f3e7` (`unlockAudioFromGesture`, Web Audio fallback, stream resolution, `playAudioIfNotPaused` guard).
5. `npm run build` pass, commit, push `main`, Vercel prod deploy.

## Files changed

- `src/app/page.js`
- `src/context/AudioContext.js`
- `src/components/preview/ImmersivePreviewModal.js`
- `src/components/audio/GlobalAudioPlayerBar.js`

## Reverted (over-additions removed)

- `pendingModalGesturePlay` state and `modalPlaySlugRef` / `featureModalPlaySlugRef` auth deferral
- `playSingleModalFromGesture` / `playFeatureModalFromGesture` and modal props `pendingPlayAfterAuth`, `onPlayFromModal`
- Modal “Tap to play” label/UI and global bar “Tap to resume”
- `needsGestureResume` / `needsGestureToResumeRef` and silent-output analyser check in `onTimeUpdate`

## Fixes applied

- **F2-corrected:** `openSingleModal` / `openFeatureModal` call `playTrack` unconditionally on cover tap (gesture chain preserved).
- **F4-corrected:** visibility handler resumes with `resumeWebAudioContextIfSuspended` + `el.play().catch(() => {})` when returning to foreground.

## Build

- Local: `npm run build` — passed (Next.js 16.2.4)
- Vercel production build — passed

## Git

- Commit: `04dc78d` — `fix(audio): correct F2 F4 mobile gesture and resume per prompt`
- Pushed: `origin/main`

## Deploy

- Deployment ID: `dpl_ftmvcwMjhf6qaanTY2P81Zc4vk5e`
- Inspect: https://vercel.com/eellian-morrows-projects/artist-platform/ftmvcwMjhf6qaanTY2P81Zc4vk5e
- Production alias: https://www.2mrrw.com

```
CHECKPOINT
files_changed: [src/app/page.js, src/context/AudioContext.js, src/components/preview/ImmersivePreviewModal.js, src/components/audio/GlobalAudioPlayerBar.js]
reverted: [pendingModalGesturePlay, modalPlaySlugRef deferral, pendingPlayAfterAuth/onPlayFromModal, Tap to play/resume UI, needsGestureToResumeRef, silent graph onTimeUpdate detection]
fixes_applied: [F2-corrected, F4-corrected]
```
