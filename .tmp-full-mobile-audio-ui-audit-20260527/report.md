# Full Mobile-First Audio & UI Audit Report

**Project:** artist-platform (2MRRW)  
**Date:** 2026-05-27  
**Mode:** READ ONLY — no code changes, commits, or deploy  
**Primary target:** iOS Safari · **Secondary:** Android Chrome · **Desktop:** last

---

## Summary table

| Severity | Count |
|----------|------:|
| HIGH | 3 |
| MED | 12 |
| LOW | 11 |
| INFO | 8 |
| **Total findings** | **34** |

---

## Confirmed working

| Area | Evidence |
|------|----------|
| Single `<audio>` element | Only mount in `AudioContext.js` 2396–2403; layout does not add second element |
| `playsInline` + webkit variant | `AudioContext.js` 2399–2401 |
| Media Session metadata + artwork sizes | `updateMediaSession` 479–507; `media-session-artwork.js` 1–7, 57–61 |
| Media Session action handlers | `play`, `pause`, `previoustrack`, `nexttrack`, `seekto`, `stop`, `seekbackward`, `seekforward`, `togglemicrophone` — 2050–2113 |
| Preview 30s enforcement | `timeupdate` handler 782–801; `seek` caps preview 1983–1985 |
| Stream retry on error | `onError` 952–983; online listener 1069–1074 |
| Entitled background signed URL upgrade | `backgroundStreamResolve` 1367–1370; `upgradeToFullStream` 1585–1675 |
| Modal error boundaries | `ModalErrorBoundary` wraps preview/feature/album modals `page.js` 1573–1645 |
| Global player persists across tabs | `GlobalAudioPlayerBar` in `layout.js` 48 outside tab content |
| Service worker registration | `layout.js` 33–36 registers `/sw.js` on load |
| SW keep-alive ACK | `sw.js` 12–19; `postKeepAliveToServiceWorker` `AudioContext.js` 426–433 |
| Release card play target 44×44 | `ReleaseCardPlayButton.js` 99–100 |
| Bar scrub live seek on touchmove | `GlobalAudioPlayerBar.js` 109–123, 139 |
| Visibility resume when returning | `visibilitychange` 2150–2159 attempts `play()` if was playing |
| Redirect stream fast path | `libraryStreamRedirectSrc` + `route.js` 81–91 |

---

## Section 1 — Full audio engine flow

See **`audio-flow.md`** for diagrams and step-by-step `playTrack` trace.

### Findings

| Sev | File:line | Snippet / behavior | Description |
|-----|-----------|-------------------|-------------|
| INFO | `AudioContext.js:289-294` | `new Audio()` preload for CS | Secondary audio element used only for preload, not playback output |
| MED | `AudioContext.js:764-772` | `resumeAfterInterrupt` on non-user `pause` | On external pause, registers `canplay` to call `audio.play()` if `stateRef.isPlaying` — may fight iOS focus rules |
| LOW | `AudioContext.js:2387-2390` | unmount cleanup | Provider unmount only clears RAF/keep-alive; Web Audio nodes not explicitly disconnected |

---

## Section 2 — Modal

### 2a. How the modal opens

| Path | File:line | Trigger | Data passed |
|------|---------|---------|-------------|
| Single preview | `page.js:1095-1118` | `openSingleModal` | `resolveCatalogPlaybackItem` → `selectedSingle`, `playTrack(playbackTrack)`, async `releaseDetail` |
| Feature | `page.js:1129-1154` | `openFeatureModal` | `featureModalItem`, same play pattern |
| Album | `page.js:1174-1183` | `openAlbumModal` | `selectedAlbum`, `playAlbumTracks(album, 0)` |
| Card click | `page.js:1833`, `CatalogGrid` `onCardClick` | user tap | routes to open handlers |
| Deep link | `page.js:1500-1515` | effect | `openSingleModal` / `openAlbumModal` |

**Gesture timing:** `playTrack` runs synchronously in the same handler as modal open (`page.js` 1115) — good for iOS autoplay policy.

**Blocking risks:**

| Sev | File:line | Issue |
|-----|-----------|-------|
| MED | `ImmersivePreviewModal.js:560-571` | Overlay `zIndex: 9000`, fixed full screen — should appear above nav (z 6700–7000) |
| LOW | `page.js:1201-1205` | `closeSingleModal` calls `pause()` — audio stops on dismiss (by design) |
| INFO | `ImmersivePreviewModal.js:1141-1142` | Returns `null` if no `slug` and no `id` |

### 2b. Modal contents

- **Scene cover:** `Scene` 176–223 preloads via `Image()`; opacity 0→0.42 on load; on error `loaded` stays false (blank scene).
- **Metadata:** title, artist, feat, type, duration, editorial via `getReleaseEditorial` / `getCreditsDisplayRows`.
- **Scrub:** `FloatingPlayer` → `ScrubBar` 269–334; `onSeekRatio` → `seek(r * displayDuration)` 676.
- **Play:** `toggle` from `useMediaEngine` 675.
- **Close:** drag pill, backdrop click, 340ms timeout animation; parent `onClose` → `pause()` on single/feature.

### 2c. Modal aesthetics (mobile)

| Sev | File:line | Issue |
|-----|-----------|-------|
| MED | `ImmersivePreviewModal.js:579` | `height: 94dvh` — good for modern iOS; no explicit `padding-bottom: env(safe-area-inset-bottom)` on sheet (contrast `globals.css` immersive shell 213) |
| LOW | `ImmersivePreviewModal.js:4232` | Modal shuffle/repeat buttons `aria-hidden` — decorative only 381–394 |
| INFO | `usePlayerBodyState.js:19` | `modalOpen` adds `is-player-modal-open` on body |

### 2d. Error handling

| Sev | File:line | Issue |
|-----|-----------|-------|
| INFO | `page.js:1573-1577` | `ModalErrorBoundary` with `stackId="immersive-preview-modal"` |
| MED | `ImmersivePreviewModal.js:1133-1151` | Wrapper returns null without boundary if invalid track — boundary never mounts |

---

## Section 3 — Scrub bar

### Global bar (`GlobalAudioPlayerBar` → `PlayerBarScrub`)

**Touch handlers (with line numbers):**

```100:141:src/components/audio/GlobalAudioPlayerBar.js
  const onScrubStart = useCallback(
    (e) => {
      e.preventDefault();
      setDragging(true);
      seekFromEvent(e);
    },
    [seekFromEvent]
  );

  useEffect(() => {
    if (!dragging) return undefined;
    const onMove = (e) => seekFromEvent(e);
    const onEnd = () => setDragging(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onEnd);
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onEnd);
    ...
  }, [dragging, seekFromEvent]);
  ...
      onTouchStart={onScrubStart}
      onTouchMove={seekFromEvent}
      onTouchEnd={seekFromEvent}
```

| Question | Global bar answer |
|----------|-------------------|
| Seek on every touchmove? | **Yes** — window `touchmove` + element `onTouchMove` |
| `preventDefault` during drag? | **Yes** on start; `touchmove` listener `{ passive: false }` |
| Buffered regions? | **No** — only fill + preview cap marker |
| Edge 0 / end? | Clamped via `ratio * maxSeek`; preview capped at 30s / 30% duration |
| Touch position | `getBoundingClientRect()` + `touches[0].clientX` |

### Modal scrub (`ImmersivePreviewModal` → `ScrubBar`)

```269:281:src/components/preview/ImmersivePreviewModal.js
function ScrubBar({ pct, t, onSeekRatio, isPreview }) {
  const barRef = useRef(null);
  const handle = (e) => {
    const rect = (barRef.current || e.currentTarget).getBoundingClientRect();
    const cx = e.touches?.[0]?.clientX ?? e.clientX;
    onSeekRatio(Math.max(0, Math.min(1, (cx - rect.left) / rect.width)));
  };
  return (
    <div
      ref={barRef}
      onClick={handle}
      onTouchStart={handle}
```

| Question | Modal scrub answer |
|----------|-------------------|
| Seek on touchmove? | **No** — only `touchStart` and `click`; no drag continuation |
| `preventDefault`? | **Not called** — page may scroll during horizontal drag attempt |
| Buffered regions? | **No** |
| Preview cap | Visual 30% dashed zone; seek ratio not capped in `handle` (display caps time via `displayDuration`) |

| Sev | Finding |
|-----|---------|
| **HIGH** | Modal scrub does not update position during touch drag — only initial touch (`ImmersivePreviewModal.js:280`) |
| MED | Modal scrub lacks `touch-action: none` / `preventDefault` — scroll conflict risk on iOS |
| LOW | Global bar scrub handle hidden until hover/drag on compact bar (`globals.css` 2633–2640) — discoverability |

---

## Section 4 — Background audio and lock screen

### 4a. Lock screen

| Item | Status | Reference |
|------|--------|-----------|
| `playsInline` | Yes | `AudioContext.js:2399` |
| Media Session | Yes | `updateMediaSession` 479–507 |
| Artwork format | `{ src, sizes, type }[]` | `buildArtworkEntries` `media-session-artwork.js:57-61` |
| Actions | play, pause, prev, next, seek ±, seekto, stop, CS toggle | 2050–2094 |

| Sev | Finding |
|-----|---------|
| INFO | Title suffix `◈` when CS mode (`AudioContext.js:491`) |

### 4b. Dynamic Island / Now Playing

Metadata set on play and rehydrate on visibility (`2150-2168`). Pause sets `playbackState` paused (`759-761`). Artwork preloaded async before `MediaMetadata` assign.

### 4c. App switch / background tab

**`visibilitychange` (full):** `AudioContext.js:2116-2170`

- **hidden:** saves position; prefetches fresh stream URL if near expiry; **does not pause audio**
- **visible:** if `wasPlayingBeforeHideRef`, resumes Web Audio + `el.play()`; rehydrates Media Session

**`pagehide` (full):** `2196-2208` — saves position only; **does not pause**

| Sev | Finding |
|-----|---------|
| MED | Audio continues on lock/background by design; iOS may still suspend — resume logic depends on `wasPlayingBeforeHideRef` + `state.isPlaying` alignment |
| LOW | `wasPlayingBeforeHide` set from `state.isPlaying && !audio.paused` (2122) — desync if OS pauses element but state lags |

### 4d. Competing audio

- `onPause` 764-772 attempts resume on `canplay` when pause was not user-initiated.
- **No** `webkitplaybacktargetavailabilitychanged` or `audioSession` interruption handlers found in `src/`.

| Sev | Finding |
|-----|---------|
| **HIGH** | No iOS audio interruption / route-change handlers — TikTok/phone call behavior relies on default `pause` event + heuristic resume |
| MED | Auto-resume on `canplay` may restart playback after user expected stay paused |

### 4e. Phone call interruption

| Expected | Actual |
|----------|--------|
| Pause during call, resume after | **Not explicitly implemented** — only generic `onPause` resume hook |

| Sev | Finding |
|-----|---------|
| MED | No `navigator.audioSession` / interruption API — `AudioContext.js` (absent) |

### 4f. Bluetooth / AirPlay

| Item | Status |
|------|--------|
| `x-webkit-airplay="allow"` | Yes `2401` |
| `audiooutputdevicechange` | `devicechange` enumerates devices only 1077-1087 |
| Headphone disconnect | **Unknown / OS default** — no explicit speaker pause |

### 4g. Low power / battery

No low-power mode detection. SW keep-alive: **20s** interval `KEEP_ALIVE_INTERVAL_MS` 61, 442-448.

| Sev | Finding |
|-----|---------|
| INFO | SW only ACKs message — does not fetch or extend media session (`sw.js` 12-19) |

### 4h. Network interruption

- Offline: `patchState({ error: "RECONNECTING" })` + `online` listener 932-946
- UI: buffering indicator in bar `GlobalAudioPlayerBar.js:602-604`; error string on stream failure `AudioContext.js:1044-1048`

---

## Section 5 — Global player bar

| Topic | Finding |
|-------|---------|
| Persists across tabs | Yes — `layout.js` 48 |
| State on tab switch | Retained in AudioContext |
| Play/pause target | Signature ring **38px** (`GlobalAudioPlayerBar.js:289`) |
| Skip buttons | **32×32** (`globals.css` 2531-2535) |
| Scrub row height | 16px compact (`globals.css` 2568-2571) |
| `DOUBLE_TAP_MS` | **300** (`constants.js` 8, used `GlobalAudioPlayerBar.js` 441) |
| Modal open | Bar still renders if `hasStarted`; modal uses separate scrub; both bind same engine |
| Safe area | CSS `bottom: 64px` fixed (`globals.css` 2442) — does not add `env(safe-area-inset-bottom)` |

| Sev | Finding |
|-----|---------|
| MED | Player dock `bottom: 64px` may overlap home indicator without extra inset (`globals.css:2442`) |
| MED | Skip 32px below 44px HIG minimum |
| LOW | Cover hit 38×38 below 44px (`globals.css:2467-2469`) |

---

## Section 6 — Colors

See **`colors.md`**. Primary accent divergence `#00ffff` vs `rgb(0, 220, 210)`.

---

## Section 7 — Animations

See **`animations.md`**. Modal sheet animation lacks `prefers-reduced-motion` guard.

| Sev | Finding |
|-----|---------|
| MED | Framer tab transitions in `page.js` not gated on reduced motion |
| LOW | Waveform `scaleY` + `filter` animations may jank on older iPhones |

---

## Section 8 — Tabs and navigation

See **`tabs-map.md`**.

| Sev | Finding |
|-----|---------|
| INFO | Dual player UX: `GlobalAudioPlayerBar` + legacy `nowPlaying` strip on desktop (`page.js:2423-2441`) |
| LOW | Main tab panels lack dedicated ErrorBoundary |

---

## Section 9 — Mobile-first UI

### 9a. Touch targets

Tailwind `w-N` grep in `src/components/` only **3 lines** — most sizing is inline/CSS. Flagged under Section 5 & modal:

| Control | Size | Sev |
|---------|------|-----|
| Modal `.c-sm` | 32px | MED `globals.css:4232` |
| Album track play | 26px | MED `ImmersivePreviewModal.js:1017-1018` |
| Modal play `.c-lg` | 60px | OK |
| Release card play | 44px | OK |

### 9b. Safe areas

- **`viewport-fit=cover`:** **Not found** in `layout.js` or app metadata export — only in gift email template.
- **Uses `env(safe-area-inset-*)`:** extensive in `globals.css`, `page.js` mobile nav, sheets.

| Sev | Finding |
|-----|---------|
| **HIGH** | No `viewport-fit=cover` in app HTML metadata — safe-area env() may be zero on some iOS configs |
| MED | Global player bar fixed `bottom: 64px` without safe-area padding |

### 9c. Scroll

- Modal track list: `overflowY: auto`, `WebkitOverflowScrolling: touch` (`ImmersivePreviewModal.js:981`)
- `usePlayerBodyState` does not lock scroll; `modalStackStore` referenced for lock elsewhere
- `player-bar-scrub` `touch-action: none` (`globals.css` 2565)

### 9d. PWA

**`public/manifest.json`:** `display: standalone`, `orientation: any`, icons 192+512.  
**SW:** minimal keep-alive only.  
**Splash:** browser default (no custom splash assets in manifest).

### 9e. Font scaling

Many **fixed px** font sizes in `page.js` and modals (8–30px). Limited use of `rem` for body text.

| Sev | Finding |
|-----|---------|
| LOW | Dynamic Type / iOS large text may not scale most storefront copy |

### 9f. Portrait vs landscape

Modal `maxWidth: 430`, `94dvh` — generally adapts. No explicit landscape-only breakage found in code review.

---

## Section 10 — Performance and memory

### 10a. Audio cleanup

| Item | Status |
|------|--------|
| Event listeners removed | Yes `1090-1110` |
| Web Audio disconnect on unmount | **No** |
| Track end reset | `ended` handler 825-924 |

### 10b. Modal cycles

- `registerModal` / `unregisterModal` on mount/unmount (`ImmersivePreviewModal.js:520-522`)
- `useBeat` / waveform timeouts cleared on dependency change
- No `setInterval` leaked in modal beyond animation timeouts

### 10c. Position memory

**File:** `position-memory.js` (full, 40 lines)

- Keys: `2mrrw_pos_${userId}_${slug}` in `localStorage`
- **No TTL or global cleanup** — keys accumulate per slug played
- Cleared on track complete (`clearPlaybackPosition` from `recordLocalListening` / track change)

| Sev | Finding |
|-----|---------|
| MED | localStorage keys never pruned for old slugs |
| LOW | Private browsing: `try/catch` swallows quota errors — resume silently fails |

---

## Unknown / could not determine (runtime)

| Item | Note |
|------|------|
| Actual iOS lock-screen duration after kill | Requires device test |
| TikTok ducking behavior | No interruption API; pause/resume heuristic only |
| Bluetooth disconnect speaker bleed | OS-dependent |
| Production `viewport` meta from Next.js defaults | No explicit export in repo — may come from Next 15 default |

---

## Deliverable index

| File | Purpose |
|------|---------|
| `audio-flow.md` | Engine flow diagram + `playTrack` |
| `colors.md` | Palette + inconsistencies |
| `animations.md` | Motion inventory |
| `tabs-map.md` | Navigation map |
| `raw-grep.txt` | Combined grep output |
| `manifest.txt` | Sources list |

**End of report.**
