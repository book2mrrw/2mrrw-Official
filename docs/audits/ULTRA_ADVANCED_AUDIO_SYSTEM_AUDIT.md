# CURSOR ULTRA-ADVANCED AUDIO SYSTEM AUDIT (Mobile-First)

**Repository:** `/Users/recharge/artist-platform`  
**Baseline:** `main` @ `0e75f7c` (P12 + P11/P11B + partial wake fixes A–D; **without** `9768269`/`ebaf979` construction changes)  
**Mode:** Read-only reconstruction + analysis (Phases 1–5)  
**Cross-read:** `MOBILE_REMOUNT_AUDIO_AUDIT.md`, `.tmp-mobile-remount-audio-fix-zip/CHANGES_APPLIED.md`, `docs/audits/PHASE_P12_*`, `PHASE_P2_*`, `PHASE19_*`, `PHASE21A_*`  
**Date:** 2026-06-03

---

## Quick return (requested)

| Field | Value |
|-------|-------|
| **Executive one-liner** | iOS suspends Web Audio on idle/background while the monolithic `AudioContext` still queues play through async stream resolution and non-gesture lifecycle recovery — producing silent second plays, wrong titles from shared album-slug identity, and 2–3s hybrid streaming stalls. |
| **Top 3 CRITICAL** | (1) Web Audio `suspended` + `WEB_AUDIO_SUSPENDED_CONTINUE_PLAY` — audible gate fails but play proceeds. (2) `visibility_return` → lightweight fail → `gesture_unlock_required` with no durable re-arm; second tap hits queued async path outside gesture. (3) Entitled `backgroundStreamResolve` → `swapToSignedStream` mid-session `audio.src` reload. |
| **ZIP path** | `/Users/recharge/Downloads/ULTRA_ADVANCED_AUDIO_SYSTEM_AUDIT.zip` |
| **Files audited** | **112** audio/playback-related source files (see §1.2) |

---

# PHASE 1 — Full System Reconstruction

## 1.1 Pipeline diagram (text)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ INGESTION & METADATA                                                        │
├─────────────────────────────────────────────────────────────────────────────┤
│ Catalog (page.js, catalog-surface) → music-playback.js (normalize, queue)   │
│   → music-access.js (entitlements, libraryStreamRedirectSrc)                │
│   → canonical-catalog.js, r2-catalog-media.js, media-determinism.js         │
│   → playback-prewarm-cache.js (card hover/tap descriptors, no signed bytes) │
└───────────────────────────────┬─────────────────────────────────────────────┘
                                │ playTrack / playQueue payload
                                ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ COMMAND LAYER (single authority)                                            │
├─────────────────────────────────────────────────────────────────────────────┤
│ UI taps → dispatchPlaybackCommand (serial commandQueueRef)                  │
│   USER_GESTURE_PLAYBACK_COMMANDS → resumeWebAudioContextFromUserGesture     │
│   → executePlaybackCommand → playTrackInternal / playQueueInternal / …      │
│ PlaybackStateMachine.js — RECOVERING, RECOVER_FAILED orchestration          │
│ playback-gate.js, resolve-playback-intent.js — scenario labels              │
└───────────────────────────────┬─────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ PLAYBACK ENGINE (persistent singleton)                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│ audio-engine-runtime.js — window.__2MRRW_AUDIO_ENGINE_RUNTIME__             │
│   • one detached <audio> on document.body (survives provider re-renders)    │
│   • commandQueueRef, activeStreamAbortRef (module-level)                    │
│ AudioContext.js (~6400 LOC) — Web Audio graph, lifecycle, Media Session     │
│   initWebAudio → MediaElementSource → analyser → panner → bass → dest       │
│ audibility.js — truth: ctx.state==="running" + currentTime advancement      │
└───────────────────────────────┬─────────────────────────────────────────────┘
                                │
          ┌─────────────────────┴─────────────────────┐
          ▼                                           ▼
┌──────────────────────┐                 ┌──────────────────────────┐
│ HYBRID STREAMING      │                 │ PREVIEW / CDN PATH        │
├──────────────────────┤                 ├──────────────────────────┤
│ syncSrc: redirect    │                 │ catalogPreviewAudioUrl    │
│   /api/library/stream│                 │ flat preview CDN paths    │
│ ?slug=&redirect=1    │                 │ 30s preview cap (modal)  │
│ background resolve:  │                 └──────────────────────────┘
│ fetchLibraryStream → │
│ swapToSignedStream   │
└──────────┬───────────┘
           ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ SERVER RESOLVER (hybrid)                                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│ GET /api/library/stream → resolvePlaybackKey → tryResolveStreamPlaybackKey  │
│   → master R2 key OR stream_key OR preview fallback                         │
│ stream-url-cache.js (signed URL memo) + stream-pipeline.js (sessions)       │
│ r2-stream-proxy.js (redirect=1 same-origin Range-safe proxy)                │
│ POST /api/stream/end — analytics                                            │
└───────────────────────────────┬─────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ STATE & UI BINDINGS                                                         │
├─────────────────────────────────────────────────────────────────────────────┤
│ AudioProvider (layout.js) — React UI state + refs (stateRef authoritative)  │
│   patchState (UI) vs patchTransport (network/buffering — P1/P12)            │
│   AudioProviderSubtree memo + playbackUiStateEqual (P12 reconcile block)    │
│ GlobalAudioPlayerBar (layout sibling) — immersive bar, scrub, CS toggle     │
│ PlaybackChromeIsland (page.js) — mini player, nowPlaying, layout store      │
│ ImmersivePreviewModal — modal tracklist → playAlbumTracks                   │
│ useMediaEngine / mediaEngineBridge — subscription adapter for modals        │
│ playback-chrome-layout-store — padding/nowPlaying without context churn     │
└───────────────────────────────┬─────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ EVENT TRIGGERS                                                              │
├─────────────────────────────────────────────────────────────────────────────┤
│ play/pause/toggle/seek — dispatchPlaybackCommand                            │
│ track change — playTrackInternal, clearContinuityFreeze (P4)                │
│ scroll/hero — page.js visibility → ensureStorefrontCarouselMedia (video)   │
│ modal open — ImmersivePreviewModal activeTrack local state + engine bridge  │
│ iOS rotation — WebKit resize; no dedicated handler; visibility fires        │
│ background→foreground — visibilitychange IIFE → lightweight/hard recovery │
│ bfcache/pageshow — coalesced lifecycle recovery (4s lock)                   │
│ entitlements:updated — UPGRADE_STREAM when previewOnly + playing             │
│ audibility watchdog (1.25s) → RECOVERY_REQUESTED                              │
│ Media Session handlers → resume/playNext (gesture-adjacent)                   │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Subsystem bullets + file ownership

| Subsystem | Owner files | Role |
|-----------|-------------|------|
| **Root mount** | `src/app/layout.js` | `AuthProvider` → `AudioProvider` → children + `GlobalAudioPlayerBar` |
| **Engine runtime** | `src/lib/playback/audio-engine-runtime.js` | Singleton `<audio>`, queue refs survive React |
| **Playback brain** | `src/context/AudioContext.js` | Commands, Web Audio, lifecycle, Media Session, stream swap |
| **Audibility truth** | `src/lib/playback/audibility.js` | Suspended ctx = inaudible |
| **Track normalization** | `src/lib/music-playback.js`, `src/lib/music-access.js` | Slugs, queue IDs, `albumSlug:trackSlug`, entitlements |
| **Hybrid resolver** | `src/lib/playback/resolve-playback-key.js`, `resolve-stream-playback.js`, `src/app/api/library/stream/route.js` | Master/stream/preview key pick |
| **Stream client** | `src/lib/playback/stream-client.js` | JSON fetch + HEAD validate signed URL |
| **Prewarm** | `src/lib/playback/playback-prewarm-cache.js`, `src/hooks/usePlaybackCardPrewarm.js` | Descriptor cache, no byte preload of full stream |
| **Orchestration FSM** | `src/media/PlaybackStateMachine.js` | Centralized hard recovery |
| **UI — global bar** | `src/components/audio/GlobalAudioPlayerBar.js` | Full player chrome |
| **UI — storefront** | `src/components/storefront/PlaybackChromeIsland.js`, `playback-chrome-layout-store.js` | Mini player island (P12 isolated) |
| **UI — modal** | `src/components/preview/ImmersivePreviewModal.js` | Album preview + tracklist play |
| **Storefront play entry** | `src/app/page.js` | `playAlbumTracks`, singles cards, carousel |
| **Media adapter** | `src/media/useMediaEngine.js`, `mediaEngineBridge.js` | Maps context ↔ modal engine |
| **Recovery bridge** | `src/components/system/AudioPhase10Bridge.js`, `src/system/recovery/*` | Queue preload, session restore |
| **Metadata determinism** | `src/lib/media/media-determinism.js` | Cover/video URL freeze per slug (not audio title) |
| **Account/entitlements** | `src/context/AuthContext.js`, `src/app/api/account/state/route.js` | `canStream`, previewOnly |

---

## 1.2 Complete audio-related file inventory (112 audited)

### Core engine & commands (21)

`src/context/AudioContext.js`  
`src/lib/playback/audio-engine-runtime.js`  
`src/lib/playback/audibility.js`  
`src/lib/playback/stream-client.js`  
`src/lib/playback/stream-pipeline.js`  
`src/lib/playback/stream-url-cache.js`  
`src/lib/playback/resolve-playback-key.js`  
`src/lib/playback/resolve-stream-playback.js`  
`src/lib/playback/resolve-playback-intent.js`  
`src/lib/playback/resolve-player-display-title.js`  
`src/lib/playback/playback-gate.js`  
`src/lib/playback/playback-diagnostics.js`  
`src/lib/playback/playback-resolver-diagnostics.js`  
`src/lib/playback/playback-prewarm-cache.js`  
`src/lib/playback/preview-resolution-cache.js`  
`src/lib/playback/position-memory.js`  
`src/lib/playback/page-playback-actions-bridge.js`  
`src/lib/playback/focus-controller.js`  
`src/lib/playback/play-path-domains.js`  
`src/lib/playback/normalize-r2-key.js`  
`src/lib/music-playback.js`

### Access, catalog, determinism (12)

`src/lib/music-access.js`  
`src/lib/media/media-determinism.js`  
`src/lib/media/canonical-catalog.js`  
`src/lib/media/r2-catalog-media.js`  
`src/lib/media/entity-resolver.js`  
`src/lib/media/media-availability.js`  
`src/lib/media/availability-cache.js`  
`src/lib/media-urls.js`  
`src/lib/feature-flags/hybrid-streaming.js`  
`src/lib/vault-audio.js`  
`src/lib/listening-history.js`  
`src/lib/offline-cache.js`

### Media layer & FSM (10)

`src/media/PlaybackStateMachine.js`  
`src/media/useMediaEngine.js`  
`src/media/mediaEngineBridge.js`  
`src/media/MediaEngine.js`  
`src/media/preloader/*` (5 files)  
`src/media/index.js`

### UI — player & chrome (18)

`src/components/audio/GlobalAudioPlayerBar.js`  
`src/components/audio/CSModeButton.js`  
`src/components/audio/PlayerCsBarButton.js`  
`src/components/audio/PlayerControlButton.js`  
`src/components/storefront/PlaybackChromeIsland.js`  
`src/components/storefront/playback-chrome-context.js`  
`src/lib/storefront/playback-chrome-layout-store.js`  
`src/hooks/usePlaybackChromeLayout.js`  
`src/components/home/StorefrontMiniPlayerBar.js`  
`src/components/home/AmbientPlaybackBackground.js`  
`src/components/preview/ImmersivePreviewModal.js`  
`src/components/preview/GlyphLyricsPanel.js`  
`src/components/player/ImmersivePlayerEngine/*` (6 files)  
`src/lib/player/useImmersivePlayback.js`  
`src/components/media/_deprecated/ModalAudioPlayer.js`

### Play entry points & hooks (14)

`src/app/page.js`  
`src/app/layout.js`  
`src/components/music/ReleaseCardPlayButton.js`  
`src/components/music/AlbumTracklistSheet.js`  
`src/components/music/MyMusicTab.js`  
`src/components/music/ContinueListening.js`  
`src/components/music/PlaylistDetail.js`  
`src/components/music/ChoppedSlowedToggle.js`  
`src/components/music/PlaybackPrewarmCardShell.js`  
`src/hooks/usePlaybackCardPrewarm.js`  
`src/hooks/usePagePlaybackActions.js`  
`src/components/home/LatestSinglesStyleRow.js`  
`src/components/home/CatalogGrid.js`  
`src/components/home/AudioVisualsSection.js`

### API routes (5)

`src/app/api/library/stream/route.js`  
`src/app/api/stream/end/route.js`  
`src/app/api/playback/events/route.js`  
`src/app/api/media/preview/route.js`  
`src/app/api/media/playback/route.js`

### Recovery, system, diagnostics (12)

`src/components/system/AudioPhase10Bridge.js`  
`src/components/system/PlaybackNetworkHints.js`  
`src/system/recovery/usePlaybackRecovery.js`  
`src/system/recovery/useSessionRecovery.js`  
`src/system/recovery/signedUrlRefresher.js`  
`src/system/recovery/useTrackHydration.js`  
`src/lib/diagnostics/playback-trace.js`  
`src/lib/diagnostics/state-churn-log.js`  
`src/lib/dev/performanceMarks.js`  
`src/lib/control-system/playback.js`  
`src/lib/server/r2-stream-proxy.js`  
`src/context/AuthContext.js` (entitlement inputs)

### Import trace (canonical play path)

```
page.js ReleaseCardPlayButton / playAlbumTracks
  → useAudioPlayer() from AudioContext.js
  → playTrack / playQueue
  → dispatchPlaybackCommand (sync gesture resume)
  → commandQueueRef.then(executePlaybackCommand)
  → playTrackInternal
      → normalizeTrack (AudioContext)
      → resolveLibraryStreamForTrack (stream-client) [background]
      → waitAudioSrcReady + playAudioIfNotPaused
      → swapToSignedStream [deferred]
  → patchState → AudioProviderSubtree (memo) / patchTransport
  → PlaybackChromeIsland + GlobalAudioPlayerBar (consumers)
  → useMediaEngine → ImmersivePreviewModal engine state
```

---

# PHASE 2 — Behavioral Tracing (code paths)

## 2.1 Simulated scenarios

| Scenario | Mount/unmount | State updates | Audio instance | Listeners |
|----------|---------------|---------------|----------------|-----------|
| **Single list click** | No provider remount; detached `<audio>` retained | `patchState` loading → playing; P12 may skip subtree reconcile | Same element; `src` set via `waitAudioSrcReady` | Element listeners bound in AudioProvider mount effect; not duplicated |
| **Release switch (entitled)** | Stable | `clearContinuityFreeze`; new `currentTrack`; `backgroundStreamResolve=true` | Same element; **second** `src` via `swapToSignedStream` | Prior stream abort via `activeStreamAbortRef` |
| **Modal open** | Modal mounts; `registerModal`; local `activeTrack` | Modal reads engine via `useMediaEngine`; may diverge from `currentTrack` until play | Engine unchanged | Modal `handleTrack` → `onPlayTrackAtIndex` → `playAlbumTracks` |
| **Scroll / hero** | Carousel videos pause on hidden; visible re-inits media (`page.js:608-613`) | No direct audio stop; large tree re-render possible pre-P12 | `<audio>` retained | Video listeners separate from audio |
| **iOS rotation** | No rotation handler; layout reflow | Possible `visibilitychange` if OS treats as background | WebKit may suspend ctx | No dup; existing handlers |
| **Background → foreground** | No remount | `lifecycleInBackgroundRef`; lightweight resume or `gesture_unlock_required`; may `recoverAudioHard` | Same element; hard recover clears `src` + `load()` | Gesture unlock listeners **removed after first unlock** (`2108-2140`) |
| **Hybrid fallback** | N/A | Preview fallback `patchState` with `previewOnly: true` | Same element, new preview src | Stream abort cancels in-flight resolve |

**Audio instance preserved?** Yes — Phase 10 `audio-engine-runtime.js` keeps one detached element. **Failure is state/graph/suspend**, not element replacement.

**Listener dup/loss?** Gesture unlock listeners are **one-shot** (`sessionUnlockedRef` gate). After first session unlock, later suspend events rely on per-command async `resumeWebAudioContextIfSuspended` — often **outside** gesture window on iOS.

## 2.2 State conflicts (multiple writers)

| Conflict | Writers | Risk |
|----------|---------|------|
| **currentTrack** | `playTrackInternal`, `swapToSignedStream` (direct `stateRef` write), `recoverAudioHard`, `AudioPhase10Bridge` recovery, CS mode | Stale UI if swap races track change (`isSamePlaybackTrack` guard partial) |
| **isPlaying** | `patchState`, element events (`play`/`pause`), lifecycle recovery, Media Session | React `isPlaying` can be true while `isAudioActuallyAudible` false |
| **Modal activeTrack vs engine** | `ImmersivePreviewModal` local state + `useMediaEngine` | Title/cover from modal row until engine catches up |
| **continuityFrozen snapshot** | Lifecycle freeze vs `clearContinuityFreeze` on track change | Stale title in `PlaybackChromeIsland` if freeze not cleared |
| **Album slug as stream identity** | `resolveAlbumTrackPlaybackItem` sets `slug: streamSlug` (album) for all tracks | Wrong stream key if server expects per-track slug; metadata bleed |
| **Async races** | `playRequestIdRef` vs `swapToSignedStream`; `commandQueueRef` serial but visibility IIFE parallel | Aborted swap or silent `return false` |
| **Stale closures** | `dispatchPlaybackCommandRef`, `playTrackRef` — mitigated by refs | Lower risk |
| **Effect deps** | Media Session effect re-binds handlers on many deps (`5719`) | Handler churn, not duplicate audio |
| **Duplicate players** | **Ruled out** for main playback — one singleton. Secondary: `streamSwapPreloadRef` hidden `Audio()`, CS preload `new Audio()`, ambient loops in `page.js` | Memory pressure → iOS tab discard |

---

# PHASE 3 — Root Cause Analysis

## 3.1 Audio not playing

| Layer | Mechanism | Evidence |
|-------|-----------|----------|
| **Engine** | Web Audio routed via `MediaElementSource`; `ctx.state !== "running"` ⇒ inaudible | `audibility.js:105` |
| **Engine** | `playTrackInternal` still proceeds after failed `ensureWebAudioRunning` | `3090-3101` `WEB_AUDIO_SUSPENDED_CONTINUE_PLAY` |
| **Gesture** | `unlockFromGesture` exits if `sessionUnlockedRef.current` — no re-arm on re-suspend | `2108-2109` |
| **Gesture** | Partial fix A present: sync resume in `dispatchPlaybackCommand` / `playTrack` | `5390-5393`, `5586-5587` — but **await** chain in `playTrackInternal` still breaks gesture |
| **Lifecycle** | `visibility_return` async IIFE calls `ensureWebAudioRunning` / `attemptLightweightPlaybackResume` without tap | `5827-5883` |
| **Lifecycle** | On fail → `gesture_unlock_required` suppression; user tap hits queued command | MOBILE_REMOUNT_AUDIO_AUDIT §3.2 |
| **Network** | Stream 401/403/404 → preview fallback or error state | `applyStreamResolveError` |
| **iOS** | Tab discard under memory (cinematic page + ambient Audio + video) | MOBILE_REMOUNT §2.3 |
| **Queue** | `playTrackInternal` returns `false` with intact transport — swallowed by `void playQueue` | P2 §3 |

## 3.2 Wrong title / slug / metadata bleed

| Cause | Location | Mechanism |
|-------|----------|-----------|
| **Shared album slug** | `music-playback.js:166` | Album tracks get `slug: streamSlug` (release), not `trackSlug` |
| **normalizeTrack id** | `AudioContext.js:794-826` | `id` prefers slug; album rows share release slug |
| **Modal vs queue IDs** | `page.js` modal ids vs `albumSlug:trackSlug` queue ids | Same-track detection in modal uses modal `id` |
| **Recovery placeholder** | `AudioPhase10Bridge.js:77` | `"Restored"` title on recovery fallback — filtered by `resolvePlayerDisplayTitle` |
| **CS mode title** | `resolvePlaybackPresentation` | Appends slowed suffix — can desync from card title |
| **continuityFrozen** | `PlaybackChromeIsland.js:87-103` | Shows frozen snapshot title during recovery |
| **Title merge** | `resolveCatalogPlaybackItem` spread order | Incoming track title can be overwritten by catalog lookup |
| **media-determinism** | Per-slug cover/video freeze | Does **not** govern audio title — separate concern |

## 3.3 Hybrid streaming delays

| Stage | Latency source |
|-------|----------------|
| Tap → first sound | Redirect fast path (`redirect=1`) starts on placeholder; entitled uses `backgroundStreamResolve` |
| 2–3s stall | `resolveLibraryStreamForTrack` (auth + resolver + HEAD validate) then `swapToSignedStream` → `waitAudioSrcReady` reload | P2 Repro A |
| Prewarm gap | `playback-prewarm-cache` stores descriptors only — **no** signed byte warmup on main element |
| HEAD double-fetch | `stream-client.js:241` HEAD on signed URL after JSON |
| Session churn | `findActiveStreamSession` / clear on each non-force request |
| Resolver chain | `resolvePlaybackKey` → DB + R2 head + optional stream key attempt |
| Race | User switches track before swap completes — guarded by `playRequestIdRef` but audible glitch possible |

## 3.4 iOS interruption

| Trigger | Behavior | Risk |
|---------|----------|------|
| Screen lock / hidden | OS pauses element + suspends ctx; intent captured | OK if lightweight resume on return |
| Visible return | Hard recovery if health check fails — **looks like remount** | `recoverAudioHard` strips src, `playbackState: recovering` |
| Modal unmount | Does not destroy audio element | Modal local state discarded |
| Listener cleanup | Gesture unlock removed after first unlock | Re-suspend dead zone |
| Rotation | WebKit suspend possible | Same as visibility |
| `page.js` carousel re-init | Visual “full refresh” illusion | MOBILE_REMOUNT Failure 1 |

---

# PHASE 4 — Architecture Validation

Compared to **Spotify persistent model** and **Apple Music streaming**:

| Capability | Spotify / Apple Music | 2MRRW @ 0e75f7c | Gap |
|------------|----------------------|----------------|-----|
| **Persistent engine** | OS-integrated / native AVPlayer | Detached singleton `<audio>` + Web Audio — **good foundation** (Phase 10) | Logic still in 6400-line React provider |
| **UI vs playback separation** | Remote controls ↔ engine IPC | P12 memo + `patchTransport` — **partial** | UI state still co-located with transport in one file |
| **Centralized controller** | Single playback service | `dispatchPlaybackCommand` + FSM — **good** | Lifecycle + visibility bypass queue semantics |
| **Prefetch / instant start** | Aggressive buffer + CDN edge | Redirect placeholder + deferred signed swap | **2–3s audible gap** on entitled streams |
| **Track identity** | Stable track URI | Album slug shared across tracks | **Metadata/stream key bleed** |
| **Background audio** | OS keeps session | Media Session + lightweight resume | iOS WebKit suspend; hard recover fights OS |
| **Gesture policy** | N/A (native) | Web Audio resume in gesture — **partial** (A without B/C from 9768269) | Second-play silent |
| **Hybrid streaming** | Single resolved URL at play | Master + stream_key + preview fallback | Resolver latency + mid-play swap |

---

# PHASE 5 — Final Report

## 5.1 Executive summary

**Why audio fails:** On iPhone Safari, idle and background suspend the Web Audio `AudioContext`. The baseline includes synchronous gesture resume at command dispatch (wake fix A) but still allows playback to continue when the context is not running (`WEB_AUDIO_SUSPENDED_CONTINUE_PLAY`), and uses a one-shot document gesture unlock that does not re-arm after re-suspend. Lifecycle `visibility_return` recovery runs outside user gestures; when lightweight resume fails, the user’s next tap is serialized through async stream resolution, leaving the element “playing” but inaudible per `audibility.js`.

**Why wrong metadata:** Album playback normalizes tracks with the **release slug** as `slug`/`id`, while UI layers (modal rows, chrome, Media Session) use different ID schemes (`albumSlug:trackSlug` in queue vs modal-local ids). Concurrent `continuityFrozen` snapshots and CS title mutation add visible bleed during recovery and mode toggles.

**Why slow streaming:** Entitled play intentionally starts on a same-origin redirect placeholder then **background-resolves** a signed URL and performs `swapToSignedStream` — a full `audio.src` reload mid-session. Resolver work (DB, R2 head, HEAD validation, session insert) happens on the critical path of that swap, producing the observed 2–3s stall (P2 Repro A). Prewarm cache holds URL descriptors, not warmed audio bytes on the singleton element.

## 5.2 Root cause list (ranked)

### CRITICAL

1. **Web Audio suspended but play proceeds** — `playTrackInternal` logs `WEB_AUDIO_SUSPENDED_CONTINUE_PLAY` instead of blocking; violates audibility truth (`3090-3101`, `audibility.js:105`).
2. **iOS post-wake gesture dead zone** — one-shot `unlockFromGesture` (`2108-2140`); visibility return sets `gesture_unlock_required` without durable unlock (`5864-5879`).
3. **Deferred `swapToSignedStream` mid-playback** — entitled streams reload `audio.src` after play started (`3283-3355`, `3357-3369`).

### HIGH

4. **Lifecycle hard recovery illusion** — `recoverAudioHard` clears src + recovering UI on false desync (`3884-4060`); pairs with storefront carousel re-init (`page.js`).
5. **Silent command failure** — `playTrackInternal` returns `false` without surfacing error; `playAlbumTracks` swallows (`766-798`).
6. **Album slug as playback identity** — stream + metadata keyed to release slug for all tracks (`music-playback.js:166`).

### MEDIUM

7. **Modal/engine ID divergence** — modal `activeTrack.id` vs queue `albumSlug:trackSlug` (`ImmersivePreviewModal.js:904-914`).
8. **continuityFrozen stale chrome** — mini player shows snapshot until reconciled (`PlaybackChromeIsland.js:87-103`).
9. **Stream client double network** — JSON + HEAD on every resolve (`stream-client.js:241`).
10. **Command queue stall after recovery** — 4s lifecycle lock + serial queue + 20s watchdog.

### LOW

11. **Recovery `"Restored"` placeholder** — bridged to stream URL with slug-only title (`AudioPhase10Bridge.js:66-79`).
12. **Secondary Audio elements** — CS preload, stream swap preload, ambient loops — memory pressure risk.
13. **Media Session handler re-bind churn** — large effect dependency array.

## 5.3 Exact file-level fix plan (plan only — no implementation)

| Priority | File | Function / region | Wrong today | Must change |
|----------|------|-------------------|-------------|-------------|
| C1 | `AudioContext.js` | `playTrackInternal` WEB_AUDIO gate (~3078-3102) | Continues play when ctx not running | Block play; set user-visible error; diagnostic `WEB_AUDIO_SUSPENDED_BLOCKED_PLAY` (per CHANGES_APPLIED 1.2) |
| C1 | `AudioContext.js` | `resumeInternal` | May call `audio.play()` when ctx suspended | Gate on `ensureWebAudioRunning` |
| C2 | `AudioContext.js` | `unlockFromGesture` effect (~2104-2145) | One-shot `sessionUnlockedRef` | Re-arm when `ctx.state === "suspended"`; remove listeners only when running (CHANGES_APPLIED 1.3) |
| C2 | `AudioContext.js` | `visibility_return` branch (~5864-5882) | Suppresses without scheduling user-visible unlock hint | Surface `error: "Tap play to continue"` on transport intact + suspended |
| C3 | `AudioContext.js` | `swapToSignedStream` (~3283-3355) | Reloads main element mid-play | Prefer resolving signed URL **before** first `waitAudioSrcReady` when network allows; or use preload element handoff without pause |
| C3 | `stream-client.js` | `fetchLibraryStream` | HEAD on every fetch | Cache validated content-type per slug/session |
| H4 | `AudioContext.js` | `recoverAudioHard` | Runs on lifecycle-only pause | Strengthen `lifecycleOnlyPause` fast-path; skip src strip when transport intact + OS_SUSPENDED |
| H4 | `page.js` | `onVisibility` (~608-613) | Re-inits all carousel media on visible | Debounce / diff-based re-init; don’t touch videos if playback active |
| H5 | `page.js` | `playAlbumTracks` (~783-787) | `return false` silent | Propagate error to modal `showPlaybackNotice` (partially done in modal; ensure all paths) |
| H6 | `music-playback.js` | `resolveAlbumTrackPlaybackItem` (~166) | `slug: streamSlug` only | Preserve `trackSlug` in identity; pass `trackSlug` to stream API consistently |
| M7 | `ImmersivePreviewModal.js` | `handleTrack` (~904-914) | Modal id matching | Match on `albumSlug:trackSlug` or delegate identity to `isSamePlaybackTrack` |
| M8 | `PlaybackChromeIsland.js` | continuity effect (~87-103) | Frozen title | Clear freeze when `currentTrackKey` changes |
| M9 | `playback-prewarm-cache.js` | `buildPlaybackUrlDescriptor` | No byte warmup | Optional: warm redirect URL on card long-press (mobile budget) |

## 5.4 Architectural improvements (restructure — future)

1. **Extract `PlaybackEngine` module** — Move `playTrackInternal`, stream swap, Web Audio graph, and lifecycle out of `AudioContext.js` into a non-React singleton (aligns with `.tmp-phase10-audio-engine-detachment-20260601` spec). React provider becomes thin subscription shell.

2. **Metadata isolation layer** — `PlaybackIdentity` type: `{ queueId, releaseSlug, trackSlug, displayTitle }` — never use release slug as `id` for album tracks.

3. **No remount resets** — Already have detached audio; extend to **freeze UI subtree** during lifecycle recovery (P12 pattern applied to modal + global bar).

4. **Persistent player contract** — Single write authority: `engine.setTrack(intent)` → engine emits `{ transport, presentation }` events; UI read-only.

5. **Hybrid streaming v2** — At play intent: parallel `fetchLibraryStream` + start preview/redirect; swap via Media Source Extensions or seamless preload handoff (investigate iOS MSE limits); server-side push signed URL in initial redirect response when session warm.

6. **iOS gesture coordinator** — Central `GestureUnlockCoordinator` called synchronously from every tap target before **any** `await`.

---

## Cross-audit reconciliation

| Prior audit | This audit alignment |
|-------------|---------------------|
| `MOBILE_REMOUNT_AUDIO_AUDIT.md` | Confirmed: two bugs (reload illusion + dead audio), shared iOS trigger |
| `CHANGES_APPLIED.md` | Baseline **lacks** 9768269 Fix 1.2–1.4; has partial Fix 1.1 (sync gesture in dispatch) |
| `PHASE_P12` | Reconcile elimination valid; does not fix audible stall or iOS suspend |
| `PHASE_P2` | Repro A/B/C chains confirmed in current line numbers |
| `PHASE19` | Lightweight-first recovery present; hard path still reachable |

---

## Related artifacts

- Repo copy: `docs/audits/ULTRA_ADVANCED_AUDIO_SYSTEM_AUDIT.md` (this file)
- ZIP bundle: `/Users/recharge/Downloads/ULTRA_ADVANCED_AUDIO_SYSTEM_AUDIT.zip`
- Cross-reference (repo): `MOBILE_REMOUNT_AUDIO_AUDIT.md`, `docs/audits/PHASE_P12_PLAYBACK_TRIGGERED_RECONCILIATION_ELIMINATION.md`, `docs/audits/PHASE_P2_PLAYBACK_INTERACTION_FREEZE_RCA.md`, `docs/audits/PHASE19_TRUE_BACKGROUND_AUDIO_CONTINUITY.md`, `docs/audits/PHASE21A_LIFECYCLE_AUDIO_TRUTH_MODEL_AUDIT.md`
