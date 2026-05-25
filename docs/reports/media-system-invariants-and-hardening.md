# Media System — Invariants & System-Aware Hardening

**Repo:** `/Users/recharge/artist-platform`  
**Report date:** 2026-05-24  
**Base commit:** `703e966` (polish stack continues on same branch)  
**Scope:** Playback progress (RAF), dev render profiling, animation notes, launch checklist — **no redesign, no new architecture**

---

## Five invariants (non-negotiable)

1. **Single audio element** — One `<audio>` owned by `AudioProvider` (`src/context/AudioContext.js`). Preview modal, global dock, and library UI **read** `useAudioPlayer` / `useImmersivePlayback`; they do not mount parallel players or set `src` independently.

2. **Same-track no reload** — `playTrack` compares slug/id **and** resolved `currentSrc` before calling `audio.load()`. Resume, CS swap, and stream refresh use `skipPauseInterruptionRef` where intentional; do not regress identity checks.

3. **Entitlements are not UI** — Stream access, Vault, and library playback come from backend + `/api/account/state`. UI may show denial/retry; it must not grant playback by toggling client flags.

4. **Buffering ≠ playing** — `isBuffering` reflects `waiting` / `stalled` / recovery; `isPlaying` follows `play` / `pause` and user intent (`userPausedRef`). Do not collapse these for spinner or scrubber logic.

5. **Cinematic shell is protected** — Hero (`src/app/page.js`), navigation, framer-motion atmosphere, and modal shell layout are out of scope unless explicitly requested. Media work is leaf/surgical: context, player chrome, preview controls.

---

## Elite polish — four layers

### 1. Progress (frame-aligned UI)

| Before | After (this pass) |
|--------|-------------------|
| `timeupdate` throttled `patchState({ currentTime })` at ~250ms | **rAF loop** while `!audio.paused && !audio.ended` updates `currentTime` at display refresh (~60fps max) |
| `timeupdate` still fires for analytics | `persistPlayback`, `syncPositionState`, 30s listening milestone — **no** React progress writes on `timeupdate` |
| Seek / pause / end | Immediate `patchState` on seek; **stop rAF** on pause, end, stop, emptied |

**Rule for future features:** Any UI bound to `currentTime` from context gets smooth motion from rAF; do not add second timers or per-component `timeupdate` listeners.

### 2. Animation stability

| Location | Finding | Action |
|----------|---------|--------|
| `PreviewPlayerControls` progress fill | Was `width: N%` + CSS `transition: width` | **Fixed:** `transform: scaleX` + `transition: transform` on `.player-immersive-progress-rail__fill` |
| `FloatingMainPlayer` / `CompactDockPlayer` | Still `width: ${progress}%` on fill | Document only — align to `scaleX` in a follow-up (same CSS class now supports transform) |
| `PreviewModalPlayer.js` | `transition: width 0.1s linear` on inline progress | Document only — not in this pass scope |
| `ImmersivePreviewModal` | `width`/`height` on layout layers (static, not animated) | OK — not layout-thrash animations |
| `GlobalAudioPlayerBar` | No animated width/height on progress | Uses engine components |

**Rule:** Prefer `transform` + `opacity` for motion; avoid animating `width`/`height` on progress or dock chrome.

### 3. Profiling (dev only)

- Hook: `src/lib/dev/useRenderTracker.js` — logs `[render] <label>: #N` on mount and every 10th render when `NODE_ENV === 'development'`.
- Wired: `GlobalAudioPlayerBar`, `ImmersivePreviewModal`, `PreviewPlayerControls`.
- Production: hook body is empty at runtime; no console spam.

**Rule:** Add tracker to **at most** one component per subtree when debugging re-render storms; remove or leave in place only for chronic hotspots.

### 4. Launch checklist (media)

- [ ] Single audible stream when opening preview + playing dock
- [ ] Scrubber moves smoothly during play (no 4fps stepped bar)
- [ ] Pause freezes bar; resume continues rAF
- [ ] Buffer spinner on slow stream; clears on `playing`
- [ ] Stream retry / access denied / concurrent stream flows unchanged
- [ ] CS hold preview restores prior src/rate after release
- [ ] Media Session lock screen / PWA: title, artwork, position (throttled `setPositionState` still 1s)
- [ ] `npm run build` + scoped lint on touched files
- [ ] No new `<audio>` elements in pages or modals

---

## System-aware rules for future features

1. **Extend `AudioContext`, don’t fork** — New playback modes (preview-only, radio, clip) add options to `playTrack` / refs, not a second provider.

2. **Progress is read-only downstream** — Components consume `currentTime` / `duration`; only context + seek handlers mutate element time.

3. **Modal open state ≠ track identity** — Changing preview track updates props; `key` on shell stays stable (`immersive-preview-modal` pattern).

4. **Throttle expensive work, not frames** — Analytics, `setPositionState`, position save interval stay throttled; UI progress uses rAF.

5. **Dev instrumentation is gated** — `useRenderTracker` or similar only under development; never ship verbose logging to production bundles.

---

## Automated status vs hardening checklist

### Automated (CI / scripts)

| Check | Command | Status |
|-------|---------|--------|
| Production build | `npm run build` | Run after each media pass |
| Frontend guardrails | `npm run check:frontend-guardrails` | Anchor / hero / provider protection |
| Foundation smoke | `npm run test:foundation` | Regression on critical routes |
| Scoped ESLint | `npx eslint <touched files>` | Player + context files |

### Hardening checklist (manual — not fully automatable)

| Area | Item |
|------|------|
| Progress | rAF starts on play, stops on pause/end/stop |
| Progress | No duplicate `currentTime` state in preview/page |
| Modal | Open/close 10× without remount flash or scroll lock leak |
| Stream | Expired URL refresh on resume / visibility |
| Animation | Progress bars use transform where updated |
| Perf | Dev render counts stable during 30s playback (no runaway # renders) |
| A11y | Scrubber `aria-valuenow` tracks context time |

---

## Files touched (this pass)

| File | Change |
|------|--------|
| `src/context/AudioContext.js` | rAF progress loop; decouple UI time from `timeupdate` |
| `src/lib/dev/useRenderTracker.js` | New dev hook |
| `src/components/audio/GlobalAudioPlayerBar.js` | Render tracker |
| `src/components/preview/ImmersivePreviewModal.js` | Render tracker |
| `src/components/preview/immersive/PreviewPlayerControls.js` | Render tracker; progress `scaleX` |
| `src/app/globals.css` | Progress fill: `width: 100%`, `transition: transform` |
| `docs/reports/media-system-invariants-and-hardening.md` | This document |

---

## Related reports

- `docs/reports/media-system-final-mile.md` — Pre-RAF verification checklist and master prompt
- `docs/foundation/FRONTEND_FOUNDATION_BASELINE.md` — Recovery anchor
