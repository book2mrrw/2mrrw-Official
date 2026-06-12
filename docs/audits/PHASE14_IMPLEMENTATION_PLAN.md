# Phase 14 — Implementation Plan (Fix Plan Only)

**Created:** 2026-06-01  
**HEAD at authoring:** `623fdca`  
**Scope:** Plan only — no application code changes in this deliverable.  
**Goal:** Single HTMLAudioElement source of truth; stable homepage shell; one scroll authority.

---

## Source synthesis

| Requested folder | On disk? | Substitute used |
|------------------|----------|-----------------|
| `.tmp-playback-truth-audit-20260601/` | No | Phase 7/9/10 audits + `AudioContext.js` grep |
| `.tmp-homepage-stability-followup-20260601/` | No | Error-boundary RCA, localhost repro, `page.js` / `layout.js` read |
| `.tmp-black-screen-rca-20260601/` | No | `docs/diagnostics/BLACKSCREEN_TRACE_IMPLEMENTATION.md`, Phase 13 trace |
| `.tmp-phase12-rca-20260601/` | No | `8f65cc9`, `c8a5c82`, `.tmp-page-load-crash-fix-20260601/`, `.tmp-runtime-crash-rca-20260601/` |

**On-disk audits used:** `.tmp-phase7-playback-stability-conflict-audit-20260601/`, `.tmp-phase9-playback-single-authority-20260601/`, `.tmp-phase10-audio-engine-detachment-20260601/`, `.tmp-error-boundary-rca-20260601/`, `.tmp-localhost-browser-repro-20260601/`, `.tmp-entitlement-snapshot-gating-20260601/`, `.tmp-page-load-crash-fix-20260601/`, `.tmp-runtime-crash-rca-20260601/`.

**Prior fix commits (do not re-implement):**

| Commit | What |
|--------|------|
| `ab00180` | Phases 8–10: command authority, detached audio engine |
| `34df134` | Phase 6B viewport pause/resume + playback trace |
| `9530536` | Entitlement snapshot + refresh gating |
| `8f65cc9` | SSR audio-engine ref rebind + entitlement snapshot hydration |
| `c8a5c82` | `pause` undefined in `page.js` handlers |
| `5931d11` | Phase 13 blackscreen trace (diagnostics only) |

---

## SECTION 1 — Playback Truth Architecture

**Target invariant:** `audio.paused === false` ⇔ UI `isPlaying` (and MediaSession `playing`). Web Audio analyser/effects reflect `audioCtx.state === "running"`, not React optimism.

**Authority today:** One detached `<audio>` (`audio-engine-runtime.js` + `AudioContext.js`). `MediaEngine` / `useMediaEngine` are **read models** over `registerMediaEngineBridge` + `useAudioPlayer` — not a second transport.

### 1.1 Optimistic `isPlaying` before `play()` succeeds

| # | File:line | Root cause | Exact fix |
|---|-----------|------------|-----------|
| A | `src/context/AudioContext.js:2248` | After `playAudioIfNotPaused` (L2175–2177 / L2232–2237), `patchState({ isPlaying: true })` runs even when `audio.play()` failed (`playAudioIfNotPaused` only logs `AUDIO_RESUME_FAILED`, does not revert). | Remove L2248 optimistic patch. Set `isPlaying` / `playbackState: "playing"` only in `onPlay` (L1199–1201) or after `await audio.play()` with `if (!audio.paused)` guard. Keep `playbackState: "loading"` until `playing` event. |
| B | `src/context/AudioContext.js:1938–1956` | `void loadAudioSrcAndPlay(...)` + immediate `isPlaying: true` on preview fallback during stream resolve. | `await loadAudioSrcAndPlay`; on catch, `patchState({ isPlaying: false, playbackState: "paused" })`. Success: rely on `onPlay`, not patch. |
| C | `src/context/AudioContext.js:1552–1559` | Stream error retry: `await audio.play()` in try/catch then unconditional `isPlaying: true`. | After play, `if (audio.paused) { patchState({ isPlaying: false, ... }); return; }` else let `onPlay` own state. |
| D | `src/context/AudioContext.js:1577–1594`, `2272–2290` | Preview fallback after stream failure sets `isPlaying: true` right after `loadAudioSrcAndPlay`. | Same as B — element-gated or event-driven only. |
| E | `src/context/AudioContext.js:2183–2186` | Same-track fast path: if `!audio.paused && stateRef.isPlaying`, patch playing without verifying play promise. | Use `!audio.paused` only (drop `stateRef.isPlaying` from condition); do not patch `isPlaying` here — sync from element. |
| F | `src/context/AudioContext.js:2239` | `updateMediaSession(..., { playing: true })` before transport confirmed. | Pass `playing: !audio.paused` or defer until `onPlay`. |

### 1.2 React / bridge reads `stateRef.isPlaying` instead of element

| # | File:line | Root cause | Exact fix |
|---|-----------|------------|-----------|
| G | `src/context/AudioContext.js:1110` | Bridge `getState()` exposes `isPlaying: Boolean(s.isPlaying)` from React. | `isPlaying: Boolean(s.isPlaying && el && !el.paused)` (mirror L2772 `getCurrentTrackId` truth). |
| H | `src/media/useMediaEngine.js:126` | `mapAudioContextToMediaEngine` uses `audio.isPlaying` from context value. | Add `isElementPlaying()` helper on provider (`audioRef.current && !audioRef.current.paused`) or export `getTransportPlaying()` from bridge; use in mapper. |
| I | `src/context/AudioContext.js:1268–1279` | `onPause` interrupt healer resumes when `stateRef.current.isPlaying && audio.paused` — circular with optimistic state. | Heal only when `wasPlayingBeforeInterrupt` ref set at pause time from `!audio.paused` snapshot, not from `stateRef.isPlaying`. |
| J | `src/context/AudioContext.js:1677–1684` | `online` handler retries when `stateRef.current.isPlaying`. | Gate on `!audio.paused` or last-known element-playing snapshot. |

### 1.3 Correct patterns (keep, tighten)

| File:line | Notes |
|-----------|--------|
| `AudioContext.js:1199–1201` (`onPlay`) | **Canonical** — promote to sole writer of `isPlaying: true` where possible. |
| `AudioContext.js:1255`, `1307`, `1358` (`onPause` / preview end) | Correct `isPlaying: false` from element events. |
| `AudioContext.js:2772–2773` | `getCurrentTrackId` already uses element truth — reuse pattern everywhere. |
| `AudioContext.js:3306–3341` (`syncPlaybackUiFromAudioElement`) | Good reconciliation on visibility; extend to run after failed `playTrackInternal` commands. |

### 1.4 MediaEngine vs element

| Layer | Role | Phase 14 action |
|-------|------|-----------------|
| `HTMLAudioElement` | Transport SOT | All play/pause mutations end here first |
| `AudioContext` `stateRef` | UI bridge | Derive `isPlaying` from element + `onPlay`/`onPause` |
| `MediaEngine` / bridge | Imperative snapshot | Fix G; document “bridge lags element by one frame max” |
| `useMediaEngine` consumers | UI | `page.js:1224`, `GlobalAudioPlayerBar.js:309–319` — prefer element-backed `isPlaying` after G/H |

### 1.5 WebAudio suspended while UI “playing”

| # | File:line | Root cause | Exact fix |
|---|-----------|------------|-----------|
| K | `AudioContext.js:369–377`, `1823–1824`, `2788–2789` | `resumeWebAudioContextIfSuspended` runs around play, but failure is non-fatal; CS/analyser can run while `ctx.state === "suspended"`. | After resume attempt, set `webAudioAvailableRef.current = (ctx?.state === "running")`. Gate `getAnalyser()` and CS DSP paths on running context. |
| L | `AudioContext.js:958–987` (`initWebAudio`) | UI may show “playing” with audible element but flat visualizer. | Document as acceptable OR show subtle “tap to enable effects” only when `isPlaying && ctx.state !== "running"` (no transport change). |

### 1.6 Competing resume paths (partially fixed)

| # | File:line | Status | Exact fix |
|---|-----------|--------|-----------|
| M | `AudioContext.js:2994`, `3083–3084` | **Improved** — `exitAudioVisualViewport` dispatches `VIEWPORT_RESUME` through queue (Phase 8+). | Verify no remaining `void resumeFromViewport()` bypass; add mutex ref shared with `RECOVER` / `onPause` healer (Phase 7 #2). |
| N | `AudioContext.js:3480–3499` | Visibility `RECOVER` vs viewport resume | Single `resumeCoordinatorRef` — if viewport resume in flight, defer RECOVER 100ms or no-op. |

---

## SECTION 2 — Homepage Stability

Focus: remounts, opacity flashes, black screens, “visual reload” without changing cinematic layout.

### 2.1 `tabKey` + `fadeInTab` — forced subtree remount

| Item | Location | Impact | Risk | Implementation strategy |
|------|----------|--------|------|-------------------------|
| Tab remount | `page.js:765`, `1682`, `1756`, `2074–2075`, `2655` | **High** — every `switchTab` / `switchMusicSubTab` destroys and recreates entire tab panel; `fadeInTab` starts at `opacity:0` → visible flash / “reload feel” | Medium — must preserve tab switch animation | **Option A (preferred):** Remove `setTabKey` from `switchTab`; key only `activeTab` (+ `musicSubTab`). **Option B:** Keep key but replace animation with crossfade on wrapper without remounting children (CSS `animation` on opacity of stable container). **Option C:** Narrow `key={tabKey}` to leaf sections that need reset, not whole catalog tree. |
| Animation | `page.js:2925` `@keyframes fadeInTab` | Opacity 0 for 220ms on every switch | Low if remount removed | If remount kept, change `from{opacity:0.85}` or `animation-fill-mode: backwards` + shorter duration on mobile. |
| Dependent effects | `page.js:948`, `1118` | Carousel/video sync re-runs on `tabKey` | Low | After remount fix, depend on `activeTab` only. |

### 2.2 Boot / auth shell — black frame risk

| Item | Location | Impact | Risk | Implementation strategy |
|------|----------|--------|------|-------------------------|
| Hydration gate | `AppAuthRoot.js:8–16`, `38–40` | Full-viewport `#050508` placeholder until `hydrated` — can read as black screen | Low–medium | Match placeholder to cinematic hero first frame or render children with `visibility:hidden` instead of swapping tree (no layout change). |
| AuthGate overlay | `AppAuthRoot.js:45–47`, `AuthGate.js` | OTP sheet over shell; not a black screen but blocks interaction | Low | Ensure z-index does not cover error boundary actions; already sibling overlay. |
| Route error | `app/error.js` | “Something went wrong” replaces page slot | High when thrown | **ALREADY FIXED (c8a5c82):** `pause` in `useAudioPlayer()` at `page.js:712`. Guard remaining candidates from error-boundary RCA: `RadioCarousel.js:47`, `FlowState.js:17`, cart `price.toFixed` at `page.js:2677`. |

### 2.3 Error boundaries vs blank main

| Item | Location | Impact | Risk | Implementation strategy |
|------|----------|--------|------|-------------------------|
| Next segment boundary | `layout.js:51–53` → `error.js` | Catches `page.js` throws; shows Try again | N/A | Add defensive guards at RCA lines (read-only audit list in `.tmp-error-boundary-rca-20260601/`). |
| MediaErrorBoundary | `MediaErrorBoundary.js:52–55` | `fallback ?? null` → **blank main** if child throws before Next swaps slot | Medium | Do not replace with redesign; optional `fallback={<MinimalErrorSurface />}` using existing `FallbackRenderer` (leaf only). |
| Provider errors | `layout.js:44–59` | `AudioProvider` / GAPB outside page `error.js` | High if thrown | **ALREADY FIXED (8f65cc9):** engine ref rebind. Add `global-error.js` only if layout-level crashes confirmed in Phase 13 trace. |

### 2.4 Shadow UI state — playback chrome desync

| Item | Location | Impact | Risk | Implementation strategy |
|------|----------|--------|------|-------------------------|
| `nowPlaying` | `page.js:766`, `1245–1264`, `1506–1508` | Mini player can show stale track or wrong play glyph vs `AudioContext` | Medium | Collapse to `currentTrack` + `isPlaying` from context only; delete `nowPlaying` state OR derive with `useMemo` (no `setState` sync effect). Fix `miniPlayerPlaying` to use element-backed playing after Section 1. |
| Modal gating | `page.js:1246–1256` | While modals open, `shouldShowNowPlaying` false — bar hidden while audio plays | Low UX | Allow bar when `currentTrack && hasStarted` regardless of modal flags, or dim bar instead of clearing. |
| `engineIsPlaying` | `page.js:1224–1235` | Ambient pause uses MediaEngine state (may lag) | Low | Use `isPlaying` from `useAudioPlayer()` after bridge fix (G/H). |

### 2.5 Phase 13 diagnostics (no UX fix)

| Item | Location | Impact | Risk | Implementation strategy |
|------|----------|--------|------|-------------------------|
| Blackscreen trace | `5931d11`, `BLACKSCREEN_TRACE_IMPLEMENTATION.md` | Forensic only | None | Repro with `NEXT_PUBLIC_BLACKSCREEN_TRACE=1`; correlate `[BLACKSCREEN-MOUNT]` with `tabKey` increments before changing remount behavior. |

---

## SECTION 3 — Scroll Authority

**Problem:** Two scroll models — `mainScrollRef` (catalog column) vs `useScrollRecovery` (window).

| Component | File:line | Behavior |
|-----------|----------|----------|
| Main scroller | `page.js:791`, `2030–2033` `data-main-scroll` | Internal `overflowY: auto` — primary fan browse surface |
| Scroll recovery | `useScrollRecovery.js:10–15` | Saves `window.scrollY` per pathname |
| Session recovery | `SessionRecoveryRoot.js:5–8` | Playback queue restore; no scroll |
| Blackscreen trace | `blackscreen-trace.js:234` | Already targets `[data-main-scroll]` |

### Single-scroll-authority design

1. **Canonical scroller:** `mainScrollRef` on home/catalog (`page.js`). Not `window` for `/` (and routes using same shell).
2. **`useScrollRecovery`:** Accept optional `getScrollElement(): HTMLElement | null` from context or `document.querySelector("[data-main-scroll]")`. Save/restore `element.scrollTop`, not `window.scrollY`.
3. **API:** `ScrollAuthorityProvider` at `SessionRecoveryRoot` level with `{ registerScroller, getScroller }` OR pass ref from `page.js` into recovery via lightweight context (leaf change only in recovery module).
4. **Pathname keys:** Keep `scroll:${pathname}` in `recoveryStore`; add `scroll:home:main` when pathname is `/` and main ref mounted.
5. **Tab switches:** `switchTab` already `scrollTo({ top: 0 })` at `page.js:1722`, `1738` — intentional; do not restore old tab scroll until back navigation (store per `activeTab` key: `scroll:/:tabId`).
6. **Verification:** With Phase 13 trace, confirm `[BLACKSCREEN-SCROLLRESET]` aligns with `mainScrollRef` not window.

---

## SECTION 4 — Implementation Order

Ranked by **user impact × confidence ÷ risk**. Do not redo items marked **ALREADY FIXED**.

| Rank | Item | Impact | Conf. | Risk | Notes |
|------|------|--------|-------|------|-------|
| 1 | **1.A + 1.F** — Remove optimistic `isPlaying` at end of `playTrackInternal` | High | 90% | Low | Smallest change; fixes “UI playing, silent” |
| 2 | **1.B–1.D** — Preview/stream fallback awaits + event-driven state | High | 85% | Low | Same file, same pattern |
| 3 | **2.1** — `tabKey` remount / `fadeInTab` flash | High | 80% | Medium | Biggest homepage stability win |
| 4 | **1.G–1.H** — Bridge + `useMediaEngine` element truth | Medium | 85% | Low | Fixes bar + ambient + engine desync |
| 5 | **2.4** — Remove `nowPlaying` shadow state | Medium | 75% | Medium | Touches `page.js` only; no layout redesign |
| 6 | **3** — Scroll authority (`useScrollRecovery` → main ref) | Medium | 70% | Medium | Isolated to `system/recovery` |
| 7 | **1.N + 1.M** — Resume mutex (viewport / visibility / onPause) | High | 65% | Medium | **Partially addressed** by `VIEWPORT_RESUME` command — finish mutex |
| 8 | **1.I–1.J** — Interrupt healer + online gate | Medium | 70% | Low | Follow-on from #1 |
| 9 | **2.2 guards** — RadioCarousel / cart / FlowState null guards | High (when hit) | 60% | Low | Prevents `error.js` black screen |
| 10 | **1.K–1.L** — WebAudio running gate | Low | 55% | Low | Visualizer only |
| 11 | **2.3** — MediaErrorBoundary minimal fallback | Low | 50% | Low | Avoid blank main |
| 12 | **2.2 AppAuthRoot** placeholder | Low | 40% | Medium | Cosmetic boot; test on device |

### ALREADY FIXED — do not re-implement

| Area | Evidence |
|------|----------|
| Phase 7 command authority | `dispatchPlaybackCommand`, serial queue, `PLAYBACK_COMMANDS.*` |
| Phase 8 audio command layer | `executePlaybackCommand` switch |
| Phase 9 single authority + violation traces | `logDirectInternalCallViolation` |
| Phase 10 detached engine | `audio-engine-runtime.js`, `AudioPhase10Bridge`, ref rebind |
| Phase 6B viewport | Intentional pause on AV enter; resume via `VIEWPORT_RESUME` (`2994`, `3083`) |
| SSR audio ref split | `8f65cc9`, `engineRefsRef` client rebind |
| Entitlement snapshot gating | `9530536`, `EMPTY_ENTITLEMENT_SNAPSHOT`, refresh debounce |
| `pause` undefined crash | `c8a5c82`, `page.js:712` |
| Phase 13 blackscreen trace | `5931d11` — diagnostics only; keep behind env flag |

### Suggested PR slicing

1. **PR-A (playback truth):** Section 1.A–F + G–H — `AudioContext.js` + `useMediaEngine.js` only.  
2. **PR-B (homepage):** Section 2.1 + 2.4 — `page.js` targeted.  
3. **PR-C (scroll):** Section 3 — recovery module + optional context.  
4. **PR-D (hardening):** 1.N, 2.3, 2.2 guards — after Phase 13 trace confirms.

### Verification checklist

```bash
npm run build
npm run test:foundation          # if available
npm run test:playback-resolver-fallback
NEXT_PUBLIC_PLAYBACK_TRACE=1 npm run dev   # playback regressions
NEXT_PUBLIC_BLACKSCREEN_TRACE=1 npm run dev  # tab switch + scroll + mount counts
```

Manual: iOS Safari — tab switch (no white flash), play/pause, scroll into Audio Visuals and out, background/foreground, post-checkout stream upgrade.

---

## Appendix — Key line references (verified 2026-06-01)

```
AudioContext.js:349-366   playAudioIfNotPaused (silent failure)
AudioContext.js:1199-1255 onPlay / onPause
AudioContext.js:2129-2248 playTrackInternal load + optimistic patch
AudioContext.js:2994-3084 viewport resume command
AudioContext.js:3306-3341 syncPlaybackUiFromAudioElement
page.js:712               pause from useAudioPlayer (fixed)
page.js:1682,2074         tabKey remount
page.js:1245-1264         nowPlaying sync effect
layout.js:47-58           AppAuthRoot / SessionRecoveryRoot / MediaErrorBoundary
useScrollRecovery.js:10-30 window scroll (not mainScrollRef)
```

---

*End of Phase 14 implementation plan.*
