# FULL FIX — iOS Wake Reset + Dead Audio + Screen Rotation

**Prompt:** `FULL_FIX_WAKE_AUDIO_ROTATION_PROMPT.md`  
**Audit:** `MOBILE_REMOUNT_AUDIO_AUDIT.md`  
**Prior fix:** `9768269` (gesture resume; play-block reverted in this pass)  
**Date:** 2026-06-03

## Checkpoint and commits (A/B/C/D)

| Area | SHA | Subject |
|------|-----|---------|
| Checkpoint | `3d82fcc` | `checkpoint: before wake audio rotation full fix (base 24ee29f)` |
| **Fix A** | `36fab23` | `fix(playback): skip hard recovery on intact iOS wake (Fix A)` |
| **Fix B** | `c728863` | `fix(playback): gesture resume without blocking play on suspend (Fix B)` |
| **Fix C** | `b9adb5e` | `fix(storefront): keep carousel media stable on rotation resize (Fix C)` |
| **Fix D** | `6651f5a` | `fix(home): trim idle ambient and carousel decode under playback (Fix D)` |

## HARD CONSTRAINTS — confirmation

| Constraint | Status |
|------------|--------|
| No rewrite of `new AudioContext` / `createMediaElementSource` / graph wiring | **OK** — construction blocks at `initWebAudio` / `connectWebAudioDownstream` unchanged this pass |
| No context+element rebuild on `ctx.close` (#74 approach) | **OK** — no new close/rebuild path |
| No hard-block playback when ctx not `"running"` | **OK** — restored `WEB_AUDIO_SUSPENDED_CONTINUE_PLAY` / `CONTINUE_RESUME`; removed `Tap play to continue` gate |
| No reload guard / auth / routing / SW / query-config changes | **OK** |
| No `recoverAudioHard` on intact transport after OS suspend wake | **OK** — `visibility_return` skips coalesced hard path when `transport.intact` |

## Fix A — Wake reset + keep audio graph

| File:region | Mechanism |
|-------------|-----------|
| `AudioContext.js` — `visibility_return` IIFE (~5954+) | If `evaluateLifecyclePlaybackHealth` is unhealthy but `transport.intact`, log `visibility_transport_intact_skip_hard`, suppress recovery, sync Media Session — **never** call `runCoalescedLifecycleRecovery` / `recoverAudioHard`. |
| `storefront-persistent-media.js` — `isStorefrontCarouselMediaHealthy` | In-view carousel videos already playing (`!paused`, `readyState >= 2`) → skip redundant ensure. |
| `page.js` — `ensureStorefrontCarouselMedia`, `onVisibility` | Idempotent ensure on visible; skip re-init when global playback active. |

**Audio construction modified?** **No.**

## Fix B — Tap resume, no stranded silence

| File:region | Mechanism |
|-------------|-----------|
| `AudioContext.js` — `playTrackInternal` | On suspended ctx after best-effort resume: diagnostic `WEB_AUDIO_SUSPENDED_CONTINUE_PLAY`, **continue** play path (reverts `9768269` block). |
| `AudioContext.js` — `resumeInternal` | Same: log `WEB_AUDIO_SUSPENDED_CONTINUE_RESUME`, still `audio.play()`. |
| `AudioContext.js` — `playTrack` / `resume` / `playQueue` / `playNext` | `resumeWebAudioContextFromUserGesture` synchronously before command queue (`dispatch` already covers gesture commands; queue/next explicit). |
| `AudioContext.js` — `unlockFromGesture` effect (~2127+) | **Unchanged from `9768269`** — re-arms while `ctx.state === "suspended"`. |

**Audio construction modified?** **No.**

## Fix C — Rotation no-op for playback pipeline

| File:region | Mechanism |
|-------------|-----------|
| `page.js` — home storefront effect (~595+) | Removed `window.resize` → `ensureStorefrontCarouselMedia` debounce. Scroll + initial ensure only. |
| `useSyncEngine.js` | **No change** — visibility resync only; does not touch Web Audio. |
| `AudioContext.js` | **No** `orientationchange` / `resize` listeners. |

**Audio construction modified?** **No.**

## Fix D — Idle memory trim

| File:region | Mechanism |
|-------------|-----------|
| `page.js` — ambient effect (~704+) | No ambient when `document.hidden` or bridge `isPlaying`. |
| `page.js` — home interval effect | Every 2s on home: pause ambient + `pauseStorefrontCarouselVideos` when hidden or global playback. |
| `page.js` — `onVisibility` hidden | `releaseRetainedOfflineBlobUrls()`. |
| `offline-cache.js` — `releaseRetainedOfflineBlobUrls` | Revoke cached `blobUrl` entries in localStorage while hidden. |
| `storefront-persistent-media.js` — `pauseStorefrontCarouselVideos` | Shared pause helper (not scroll-driven). |

**Web Audio graph touched?** **No.**

## Phase 0 — Failure 1 device branch

**Deferred / not run** — No physical iPhone Safari probe (`[NAV]` / `[PAGESHOW persisted]`) in this pass. True tab-discard reload mitigation is partial (Fix D memory trim only).

## Must-not-regress

| System | Touched? |
|--------|----------|
| `navigator.mediaSession` handlers (`5587-5654`) | **No** |
| Background-audio lifecycle (Phases 19–21) | **No** structural change beyond wake skip-hard |
| Entitlement stream / 30s preview | **No** |
| Immersive modal command authority | **No** |
| CS/Slowed toggle | **No** |
| Gifting/ownership | **No** |

## Verification (physical iPhone — pending)

| Step | Status |
|------|--------|
| 1. Play → sound | **Pending** |
| 2. Dim ~30s → wake, no redraw, sound | **Pending** |
| 3. Second track audible first tap | **Pending** |
| 4. Rotate while playing | **Pending** |
| 5. Lock-screen controls | **Pending** |
| 6. Background → return | **Pending** |

## Build / guardrails

| Check | Result |
|-------|--------|
| `npm run build` | **PASS** |
| `npm run check:frontend-guardrails` | **PASS** (0 errors, 3 pre-existing `page.js` warnings) |

## Deploy

**Y** — preview/production deploy required for on-device ear verification.

## New issues (report only)

- `9768269` graph-reconnect in `initWebAudio` / `recoverAudioHard` left in place; not reverted (not construction rewrite; monitor on device).
- True iOS tab discard reload still possible under extreme memory — Fix D reduces pressure only.
