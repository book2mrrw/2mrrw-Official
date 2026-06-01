# Phase 7 — Playback Stability Conflict Map

**Repo:** `/Users/recharge/artist-platform`  
**HEAD:** `34df134` — *Phase 6B viewport-safe focus resume, Phase 6C playback trace, playback stability*  
**Mode:** Read-only audit (no code changes)  
**Date:** 2026-06-01  

**Scope note:** Phase 6B viewport pause/resume (`enterAudioVisualViewport` / `exitAudioVisualViewport`) is **approved product behavior**. This map flags **conflicts with other controllers**, not the policy itself.

---

## 1) Full inventory (A–G)

### A — Serial playback command queue

| Location | Role |
|----------|------|
| `src/context/AudioContext.js` — `PLAYBACK_COMMANDS`, `dispatchPlaybackCommand`, `executePlaybackCommand`, `commandQueueRef`, `activeCommandRef` | Single-writer command pipeline for user/API actions: play, pause, resume, seek, queue, stop, recover |
| `src/context/AudioContext.js` — `playTrack`, `pause`, `resume`, `toggle`, `seek`, `playNext`, `stop` | Public API → `dispatchPlaybackCommand` |
| `src/context/AudioContext.js` — `playTrackInternal`, `pauseInternal`, `resumeInternal`, `stopInternal` | Executed only inside `executePlaybackCommand` (except see **B bypass**) |

### B — Viewport / Audio Visuals focus (Phase 6B, live in AudioContext)

| Location | Role |
|----------|------|
| `src/context/AudioContext.js` — refs: `isInAudioVisualViewportRef`, `wasPlayingBeforeViewportPauseRef`, `viewportPauseRef`, `resumeEligibleRef`, `lastTrackIdRef`, `lastUserActionRef`, `viewportResumeInFlightRef` | Viewport session memory |
| `src/context/AudioContext.js` — `pauseForViewport`, `enterAudioVisualViewport`, `exitAudioVisualViewport`, `shouldAutoResumeViewport`, `resumeFromViewport`, `resumeTrackAtPosition`, `clearViewportResume` | Pause music when AV section focused; resume when exit if eligible |
| `src/app/page.js` — `handleAudioVisualsFocused` / `handleAudioVisualsExit` → `enterAudioVisualViewport` / `exitAudioVisualViewport` | Shell wires IO callbacks |
| `src/app/page.js` — `AudioVisualsSection` — `IntersectionObserver` (L423–467), `onAudioVisualsFocused` / `onAudioVisualsExit`, YouTube `postMessage` play/pause | Visual focus + iframe control |
| `src/lib/playback/focus-controller.js` — `focusController` | **Orphaned** module-level snapshot store; **not imported** by `page.js` or `AudioContext` at HEAD |

### C — Document visibility / bfcache / PWA lifecycle

| Location | Role |
|----------|------|
| `src/context/AudioContext.js` — `wasPlayingBeforeHideRef`, `onVisibility` (L3299–3377), `syncPlaybackUiFromAudioElement` | Hidden: save position, refresh stream meta; visible: UI sync + optional `RECOVER` |
| `src/context/AudioContext.js` — `onPageShow`, `onBeforeUnload`, `onPageHide` | Media session persistence, bfcache rehydrate |
| `src/lib/diagnostics/playback-trace.js` — `recordPlaybackTraceContext` visibility fields | Forensics timestamps |

### D — Media Session / OS transport

| Location | Role |
|----------|------|
| `src/context/AudioContext.js` — `updateMediaSession`, `rehydrateMediaSession`, handlers L3227–3296 | Lock screen / BT / CarPlay actions → `pause`/`resume`/`seek`/`stop` via **command queue** |
| `src/lib/media-session-artwork.js` — persist/read track for session | Survives background |

### E — Stream URL lifecycle / `<audio>` src

| Location | Role |
|----------|------|
| `src/lib/playback/stream-client.js` — `fetchLibraryStream`, `streamUrlNeedsRefresh`, `clearLibraryStreamSession` | Signed URL fetch, refresh, session end |
| `src/context/AudioContext.js` — `resolveLibraryStreamForTrack`, `activeStreamAbortRef`, `waitAudioSrcReady`, `streamMetaRef` | Src swap, abort in-flight fetch on new play |
| `src/context/AudioContext.js` — `upgradeToFullStream` (L2286+), `onEntitlementsUpdated` listener (L2379–2405) | Preview → full stream while playing |
| `src/context/AudioContext.js` — `resumeInternal` stream refresh branch (L2749–2791) | Post-resume URL refresh can re-swap src |
| `src/lib/diagnostics/playback-trace.js` — `logStreamLifecycle` | Phase 6C trace |

### F — Auth / entitlements / recovery hydration

| Location | Role |
|----------|------|
| `src/context/AuthContext.js` — `refreshAccountState`, `useEntitlementAccountState` (EMPTY while `loading`) | Entitlement source of truth for UI/playback gates |
| `src/context/AudioContext.js` — `useAuth`, `useEntitlementAccountState`, `authLoading` in `playTrackInternal` / listener effect deps | Gates progress restore; rebinds audio listeners on `authLoading` flip |
| `src/lib/diagnostics/state-churn-log.js` — `notifyEntitlementsUpdated` | Debounced `entitlements:updated` custom event |
| `src/app/page.js` L1547, `src/app/success/page.js` L129 | Dispatch entitlement updates after checkout |
| `src/system/recovery/useSessionRecovery.js` | Mount: hydrate queue → `2mrrw:playback-recovery` event |
| `src/components/system/AudioPhase10Bridge.js` | Listens recovery event; `setQueue` if idle session |
| `src/system/recovery/usePlaybackRecovery.js` | Persist queue/position every 5s while playing |
| `src/components/system/SessionRecoveryRoot.js` | Mounts `useSessionRecovery` in layout |

### G — UI shell / render churn (non-authoritative but desync-prone)

| Location | Role |
|----------|------|
| `src/app/page.js` — `nowPlaying` state (L751), sync effect (L1230–1249), `miniPlayerPlaying` (L1491–1493) | Mini-player display shadow of `currentTrack` |
| `src/app/page.js` — `tabKey` remount on `switchTab` / `switchMusicSubTab` (L1660, L1734, L2051) | Tab subtree fade remount (feels like reload) |
| `src/app/page.js` — modals: `openFeatureModal` clears `nowPlaying`, `closeFeatureModal` → `pause()` | Competing pause paths |
| `src/app/page.js` — ambient `<audio>` pause when `isPlaying` (L1222–1228); carousel `<video>` pause (L786–805) | Secondary media elements |
| `src/media/useMediaEngine.js` | Thin subscription over AudioContext + bridge (not a second engine) |
| `src/components/audio/GlobalAudioPlayerBar.js` | Dock UI; `engineIsPlaying ?? isPlaying` |
| `src/components/system/AudioPhase10Bridge.js` | Recovery + preloader only |

---

## 2) Conflict matrix per system

| System | Conflicts with | Mechanism | Severity |
|--------|----------------|-----------|----------|
| **B Viewport** | **A Command queue** | `pauseForViewport` / `resumeFromViewport` call `pauseInternal` / `resumeInternal` **directly**, not `dispatchPlaybackCommand` | **High** |
| **B Viewport** | **E Stream** | Exit resume while `playTrackInternal` in flight → `activeStreamAbortRef.abort()` | **High** |
| **B Viewport** | **C Visibility** | `shouldAutoResumeViewport` blocks if `document.visibilityState !== 'visible'`; visibility `RECOVER` may run concurrently | **Medium** |
| **A Command queue** | **E Stream** | `cancelActiveStream` on play/stop; stale command cleanup L3033–3048 | **Medium** |
| **Audio `onPause`** | **B Viewport** | Non-user, non-viewport pause attaches `canplay` auto-resume (L1200–1217) — can fight viewport if flags mis-ordered | **Medium** |
| **F Entitlements** | **E Stream** | `entitlements:updated` → `upgradeToFullStream` during preview playback | **Medium** |
| **F Auth loading** | **A/E** | `authLoading` in audio listener `useEffect` deps (L1678) — full listener detach/reattach | **Low–Med** |
| **G nowPlaying** | **A state** | `nowPlaying` can diverge from `currentTrack`/`isPlaying` (slug match gate) | **Medium** |
| **Recovery** | **A** | `useSessionRecovery` + `AudioPhase10Bridge` only restore when `!hasStarted && queue empty` — low race if guard holds | **Low** |
| **Dead focus-controller** | **B** | Duplicate conceptual model; no runtime conflict (unused) | **Info** |

---

## 3) Multi-controller, desync, lifecycle, false reload

### Multi-controller

At HEAD there are **at least four pause/resume authorities**:

1. **Serial command queue** — user, media session, modals (`pause()`).
2. **Viewport controller** — `enterAudioVisualViewport` / `exitAudioVisualViewport` (bypasses queue).
3. **Visibility controller** — `visibilitychange` → `syncPlaybackUiFromAudioElement` / `RECOVER`.
4. **Native `onPause` interrupt healer** — auto `audio.play()` on `canplay` when pause was neither user nor viewport.

Plus **OS media session** (routes into queue) and **stream upgrade** (`upgradeToFullStream`, internal src swap).

### Desync (render vs audio)

| Symptom | Likely cause |
|---------|----------------|
| Mini player shows playing, audio silent | `nowPlaying` set from `currentTrack` while `isPlaying` false after viewport/visibility pause; `miniPlayerPlaying` requires slug match **and** `isPlaying` |
| Mini player visible, wrong track title | `nowPlaying` not cleared when `openFeatureModal` calls `setNowPlaying(null)` but playback continues via `playCanonicalCatalogItem` |
| Global bar vs page disagree | `GlobalAudioPlayerBar` uses `useMediaEngine` bridge snapshot; page uses `useAudioPlayer` + local `nowPlaying` |
| UI says paused, audio plays | `syncPlaybackUiFromAudioElement` recover path; or `onPlay` not yet mirrored to React state |

### Lifecycle

| Event | Controllers touched |
|-------|---------------------|
| Scroll into Audio Visuals | IO → `enterAudioVisualViewport` → viewport pause |
| Scroll out | IO → `exitAudioVisualViewport` → `resumeFromViewport` (async, no queue) |
| Tab switch (`tabKey++`) | Remounts tab DOM; **does not** stop AudioProvider; may remount IO observers with stale closures (`AudioVisualsSection` effect `[]` deps) |
| Auth `loading` false | `useEntitlementAccountState` flips EMPTY→full; page re-render; may fire `entitlements:updated` |
| Checkout success | `notifyEntitlementsUpdated` → stream upgrade |
| App background | visibility hidden → position save, stream meta refresh |
| App foreground | visibility visible → `RECOVER` command **or** UI sync only |

### False reload

| Signal | Actual mechanism | Playback impact |
|--------|------------------|-----------------|
| Entire tab content fades | `tabKey` wrapper `animation: fadeInTab` | None direct; remounts observers/children |
| Locks/gifts flicker | `useEntitlementAccountState` EMPTY until `loading` clears | Indirect via entitlement-dependent `playTrack` metadata |
| Guest→admin UI jump | `accountState` hydration + `page.js` monolith re-render | Does **not** remount `AudioProvider` (layout stable) |
| “Reload” after purchase | `refreshAccountState` + `notifyEntitlementsUpdated` | May trigger `upgradeToFullStream` (src swap), not full page reload |

---

## 4) Phase 6B verification (focus-controller superseded)

| Artifact | Status at `34df134` |
|----------|---------------------|
| `page.js` → `focusController` | **Not used** |
| `page.js` → `enterAudioVisualViewport` / `exitAudioVisualViewport` | **Active** (L694–695, L807–814, passed to `AudioVisualsSection`) |
| `AudioContext.js` viewport refs + functions | **Active** (L564–570, L2901–2935) |
| `src/lib/playback/focus-controller.js` | Present but **orphaned** (zero imports under `src/`) |

Phase 6B logic lives entirely in **AudioContext**, not the deleted/wired `focus-controller` module.

---

## 5) Cross-reference to prior audits

| Prior doc | Still valid at HEAD? |
|-----------|---------------------|
| `.tmp-phase5b-playback-death-admin-hydration-20260531/ROOT_CAUSE_RANKING.md` — AV `pause()` #1 | **Superseded** for pause path — now viewport API, same UX intent |
| Same — entitlement EMPTY→full flicker | **Still valid** |
| `.tmp-phase6b-final-viewport-safe-resume-20260531/report.md` — focus-controller orphaned | **Still valid** |
| `.tmp-phase6c-playback-interruption-trace-20260531/` — trace hooks | **Still valid**; use for repro |

---

## 6) Authority summary (preview)

**Canonical playback truth:** single `<audio>` in `AudioProvider` + `stateRef` / `setState` in `AudioContext.js`.  

**Not authoritative:** `page.js` `nowPlaying`, `focus-controller.js`, recovery store (until applied via idle `setQueue`), trace ring buffers.

See `PLAYBACK_CONTROLLER_AUTHORITY_GRAPH.md` and `STATE_OF_TRUTH_MATRIX.md`.
