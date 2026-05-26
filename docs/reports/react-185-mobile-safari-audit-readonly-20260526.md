# React #185 Mobile Safari Audit (Read-Only)

**Date:** 2026-05-26  
**Error:** React #185 — Maximum update depth exceeded  
**Scope:** Last 6 commits + 5 target files + related changed files

---

## Executive Summary

React #185 means **synchronous nested `setState` chains in a single flush** (not merely high render rate). The last 6 commits introduced a **CS cover transition system** (`useCsCoverTransition`, `CoverArtCS`, `ImmersiveModalScene` pulse, `TrackMeta` title flash) wired into **mobile touch-hold CS preview** in `GlobalAudioPlayerBar`.

**Most likely mobile Safari loop causes (ordered):**

1. **`useCsCoverTransition.js:28-31`** — When `csMode` is unchanged, the effect still calls `setDisplaySrc` / `setDisplayType` on every `[baseSrc, csSrc, …]` change. If parent props oscillate (URL normalization, track object churn, or hold-preview threshold flicker), this can re-enter the effect in the same commit wave.

2. **`CoverArtCS.js:26-33` + hold RAF in `GlobalAudioPlayerBar.js:456-510`** — Local `csMode = isLocked || csOpacity >= 1` can flip the hook’s `csMode` to `true` during touch-hold (`csHoldOpacity` animates 0→1 via `requestAnimationFrame`) **before** parent `isLocked` (`csMode`) is true. That fires the full transition path (`setPhase`, timed `setDisplaySrc`) on every hold, stacked with per-frame `setCsHoldOpacity` — a classic mobile-only trigger.

3. **`GlobalAudioPlayerBar.js:420-425` (`coverFlipKey` effect)** — `setFlipPhase(true)` on every `coverFlipKey` change; combined with CS toggles and unstable cover fields from new CS catalog mapping (`4c462c6`), can cascade with (1) and (2).

Desktop likely avoids this because touch-hold CS preview and mobile mini-dock scrub/touch paths are inactive.

---

## Step 1 — Last 6 Commits

```
097c6a6 fix(resilience): 4s timeout on all Control System calls…
f06ec3e feat(cs): CS button on all playback surfaces…
8497aa0 feat(cs): cinematic CS transition — blur-dissolve cover swap…
cd1986e fix(gifts): bulk collector query schema fix…
4c462c6 feat(catalog): map CS audio and cover fields from Control System API
2cb391c fix(audio): remove watchdog, fix crossfade guard, preload auto…
```

### All files changed (19)

| File |
|------|
| `/Users/recharge/artist-platform/src/app/api/catalog/hydrate/route.js` |
| `/Users/recharge/artist-platform/src/app/api/catalog/releases/route.js` |
| `/Users/recharge/artist-platform/src/app/api/gifts/bulk/route.js` |
| `/Users/recharge/artist-platform/src/app/globals.css` |
| `/Users/recharge/artist-platform/src/app/page.js` |
| `/Users/recharge/artist-platform/src/components/audio/GlobalAudioPlayerBar.js` |
| `/Users/recharge/artist-platform/src/components/audio/PlayerCsBarButton.js` |
| `/Users/recharge/artist-platform/src/components/player/ImmersivePlayerEngine/FloatingMainPlayer.js` |
| `/Users/recharge/artist-platform/src/components/preview/immersive/FloatingArtworkHero.js` |
| `/Users/recharge/artist-platform/src/components/preview/immersive/ImmersiveModalScene.js` |
| `/Users/recharge/artist-platform/src/components/preview/immersive/ImmersiveModalStage.js` |
| `/Users/recharge/artist-platform/src/components/preview/immersive/PreviewPlayerControls.js` |
| `/Users/recharge/artist-platform/src/components/preview/immersive/TrackMeta.js` |
| `/Users/recharge/artist-platform/src/components/ui/CoverArtCS.js` |
| `/Users/recharge/artist-platform/src/context/AudioContext.js` |
| `/Users/recharge/artist-platform/src/hooks/useCsCoverTransition.js` |
| `/Users/recharge/artist-platform/src/lib/control-system/client.js` |
| `/Users/recharge/artist-platform/src/lib/control-system/media.js` |
| `/Users/recharge/artist-platform/src/lib/control-system/releases.js` |

---

## Step 2 — Required File Content

### 1. `useCsCoverTransition.js` — COMPLETE

```1:65:/Users/recharge/artist-platform/src/hooks/useCsCoverTransition.js
"use client";

import { useEffect, useRef, useState } from "react";

export const CS_TRANSITION_TOTAL_MS = 1200;
const SWAP_MS = 200;

/**
 * 1.2s CS cover transition: blur-in 200ms → swap at 200ms → blur-out 400ms.
 * Returns phase classes for artwork, scene orb pulse, and title flash.
 */
export function useCsCoverTransition({
  csMode,
  baseSrc,
  csSrc,
  baseType = "image",
  csType = "image",
}) {
  const [displaySrc, setDisplaySrc] = useState(() => (csMode && csSrc ? csSrc : baseSrc));
  const [displayType, setDisplayType] = useState(() => (csMode && csSrc ? csType : baseType));
  const [phase, setPhase] = useState("idle");
  const prevCsMode = useRef(csMode);

  useEffect(() => {
    const targetSrc = csMode && csSrc ? csSrc : baseSrc;
    const targetType = csMode && csSrc ? csType : baseType;

    if (prevCsMode.current === csMode) {
      setDisplaySrc(targetSrc);
      setDisplayType(targetType);
      return undefined;
    }

    prevCsMode.current = csMode;
    setPhase(csMode ? "entering" : "exiting");

    const swapTimer = window.setTimeout(() => {
      setDisplaySrc(targetSrc);
      setDisplayType(targetType);
    }, SWAP_MS);

    const endTimer = window.setTimeout(() => setPhase("idle"), CS_TRANSITION_TOTAL_MS);

    return () => {
      window.clearTimeout(swapTimer);
      window.clearTimeout(endTimer);
    };
  }, [baseSrc, baseType, csMode, csSrc, csType]);

  const artPhaseClass =
    phase === "entering"
      ? "modal-immersive-art--cs-entering"
      : phase === "exiting"
        ? "modal-immersive-art--cs-exiting"
        : "";

  return {
    displaySrc,
    displayType,
    phase,
    artPhaseClass,
    sceneEntering: phase === "entering" || phase === "exiting",
    titlePulseClass: phase === "entering" ? "art-lbl--cs-pulse" : "",
  };
}
```

### 2. `FloatingArtworkHero.js` — useEffect hooks

**None.** This file has no `useEffect` hooks. It delegates to `useCsCoverTransition` (which contains the only effect).

### 3. `ImmersiveModalScene.js` — ALL useEffects

**Effect 1 — lines 23-29**

```javascript
  useEffect(() => {
    if (prevCsMode.current === csMode) return undefined;
    prevCsMode.current = csMode;
    setCsEntering(true);
    const timer = window.setTimeout(() => setCsEntering(false), 1200);
    return () => window.clearTimeout(timer);
  }, [csMode]);
```

**Effect 2 — lines 45-67**

```javascript
  useEffect(() => {
    if (!analyser) return undefined;
    const dataArray = new Uint8Array(analyser.frequencyBinCount);

    const tick = () => {
      analyser.getByteFrequencyData(dataArray);
      const bass = dataArray.slice(0, 4).reduce((a, b) => a + b, 0) / (4 * 255);
      const mid = dataArray.slice(5, 20).reduce((a, b) => a + b, 0) / (15 * 255);

      if (orbARef.current) {
        orbARef.current.style.transform = `translate(${bass * 7}%, ${bass * 9}%) scale(${1 + bass * 0.15})`;
      }
      if (orbBRef.current) {
        orbBRef.current.style.transform = `translate(${-mid * 7}%, ${-mid * 6}%) scale(${1 + mid * 0.1})`;
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [analyser]);
```

### 4. `GlobalAudioPlayerBar.js` — ALL useEffects + state outside effects

**PlayerBarScrub — lines 114-128**

```javascript
  useEffect(() => {
    if (!dragging) return undefined;
    const onMove = (e) => seekFromEvent(e);
    const onEnd = () => setDragging(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onEnd);
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onEnd);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onEnd);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
    };
  }, [dragging, seekFromEvent]);
```

**GlobalAudioPlayerBar — lines 374-380**

```javascript
  useEffect(() => {
    csModeRef.current = csMode;
    if (csMode) {
      setCsHoldOpacity(0);
      holdActiveRef.current = false;
    }
  }, [csMode]);
```

**Lines 382-391**

```javascript
  useEffect(() => {
    const check = () => {
      const w = window.innerWidth;
      setWindowWidth(w);
      setIsMobile(w < 768);
    };
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);
```

**Lines 395-400**

```javascript
  useEffect(() => {
    if (!hasStarted || !currentTrack) {
      setExpanded(false);
      setSwipeOffset(0);
    }
  }, [hasStarted, currentTrack]);
```

**Lines 402-406**

```javascript
  useEffect(() => {
    if (!expanded) return undefined;
    registerModal("global-audio-player-expanded");
    return () => unregisterModal("global-audio-player-expanded");
  }, [expanded]);
```

**Lines 408-414**

```javascript
  useEffect(
    () => () => {
      if (holdRafRef.current) cancelAnimationFrame(holdRafRef.current);
      if (tapTimeoutRef.current) window.clearTimeout(tapTimeoutRef.current);
    },
    []
  );
```

**Lines 420-425**

```javascript
  useEffect(() => {
    if (!coverFlipKey) return undefined;
    setFlipPhase(true);
    const t = window.setTimeout(() => setFlipPhase(false), 200);
    return () => window.clearTimeout(t);
  }, [coverFlipKey]);
```

**Lines 427-431**

```javascript
  useEffect(() => {
    if (!currentTrack) return;
    const ambient = csMode && csCover ? csCover : baseCover;
    if (ambient) setAmbientCoverUrl(resolveAbsoluteArtworkUrl(ambient));
  }, [baseCover, csCover, csMode, currentTrack]);
```

**State set outside effects (not exhaustive):**

| Location | Setter | Trigger |
|----------|--------|---------|
| 108 | `setDragging(true)` | scrub touch/mouse start |
| 456-474 | `setCsHoldOpacity` | RAF in `animateHoldOpacity` (hold preview) |
| 477-513 | `setCsHoldOpacity(0)`, `setAmbientCoverUrl` | cover touch start (double-tap CS, hold) |
| 515-531 | `setAmbientCoverUrl` | cover touch move cancel |
| 533-567 | `setAmbientCoverUrl` | cover touch end |
| 622-629 | `setSwipeClosing`, `setExpanded`, `setSwipeOffset` | swipe dismiss |
| 632-653 | `setSwipeOffset` | expanded player swipe |
| 665 | `setExpanded(true)` | expand handler |

Also: `useRenderTracker` (line 294) runs a **dep-less** effect every render (dev-only logging, no setState).

### 5. `AudioContext.js` — `initWebAudio`

**Definition:** lines 396-426 (`useCallback`, empty deps)

**Call site:** **Only inside `playTrack`** at line 907 — **not on mount**:

```906:910:/Users/recharge/artist-platform/src/context/AudioContext.js
  const playTrack = useCallback(async (track, options = {}) => {
    initWebAudio();
    if (audioCtxRef.current?.state === "suspended") {
      void audioCtxRef.current.resume();
```

Also exported in context `value` at line 1223 but **no mount-time call**. Initialized on first user-initiated playback (`playTrack`).

---

## Step 3 — useEffect Audit Tables

### `useCsCoverTransition.js`

| File:Line | Deps | State set | State in deps? | Loop? |
|-----------|------|-----------|----------------|-------|
| 24-48 | `[baseSrc, baseType, csMode, csSrc, csType]` | `displaySrc`, `displayType`, `phase` (on csMode change) | `phase`/`displaySrc`/`displayType` NOT in deps | **YES (conditional)** — lines 28-31 unconditionally set display state when csMode unchanged; if `baseSrc`/`csSrc` oscillate from parent, effect re-enters synchronously |

### `FloatingArtworkHero.js`

No `useEffect` hooks. Loop risk lives in `useCsCoverTransition` (used twice per tree: hero + dock `CoverArtCS`).

### `ImmersiveModalScene.js`

| File:Line | Deps | State set | In deps? | Loop? |
|-----------|------|-----------|----------|-------|
| 23-29 | `[csMode]` | `csEntering` | No (guarded by ref) | **NO** — ref prevents re-fire on same csMode |
| 45-67 | `[analyser]` | none (DOM refs only) | N/A | **NO** |

### `GlobalAudioPlayerBar.js`

| File:Line | Deps | State set | In deps? | Loop? |
|-----------|------|-----------|----------|-------|
| 114-128 (Scrub) | `[dragging, seekFromEvent]` | `dragging` via listener | `dragging` yes | **NO** |
| 374-380 | `[csMode]` | `csHoldOpacity(0)` | No | **NO** — one-shot on csMode change |
| 382-391 | `[]` | `windowWidth`, `isMobile` | No | **NO** (Safari resize can re-fire, not loop) |
| 395-400 | `[hasStarted, currentTrack]` | `expanded`, `swipeOffset` | No | **LOW** — if `currentTrack` identity churns, repeated collapse; bails if already false |
| 402-406 | `[expanded]` | none (modal stack) | N/A | **NO** |
| 408-414 | `[]` | none (cleanup) | N/A | **NO** |
| 420-425 | `[coverFlipKey]` | `flipPhase` | No | **LOW** — flip animation on cover key change |
| 427-431 | `[baseCover, csCover, csMode, currentTrack]` | `ambientCoverUrl` | No | **NO** if URL stable |

### `AudioContext.js` (requested initWebAudio file)

| File:Line | Deps | State set | In deps? | Loop? |
|-----------|------|-----------|----------|-------|
| 249-251 | `[user?.id]` | ref only | N/A | **NO** |
| 451-459 | `[state]` | none (`notifyMediaEngineBridge`) | N/A | **NO** alone; fans re-renders to subscribers |
| 461-484 | `[]` | none | N/A | **NO** |
| 486-865 | 9 callbacks | via audio events | N/A | **NO** |
| 1287-1297 | `[upgradeToFullStream]` | none (listener) | N/A | **NO** |
| 1414-1417 | **MISSING** | refs only | N/A | **NO** |
| 1648-1711 | 7 callbacks | none (handlers) | N/A | **NO** |
| 1713-1804 | 3 callbacks | via visibility handlers | N/A | **NO** |
| 1951 | `[stopProgressRaf]` | cleanup | N/A | **NO** |

### Other changed files — suspicious useEffects

| File:Line | Notes | Loop? |
|-----------|-------|-------|
| `TrackMeta.js:32-42` | `[csMode]` → `setTitlePulseClass`; ref-guarded | **NO** |
| `CoverArtCS.js` | Uses `useCsCoverTransition` (see above) | **YES (via hook + hold opacity)** |
| `PreviewPlayerControls.js:115-135` | analyser RAF, DOM only | **NO** |
| `PreviewPlayerControls.js:179-195` | `[isPlaying]` → beat pulse timeouts | **NO** |
| `useCoverPalette.js:204-237` | `[coverSrc, coverType]` → `setPalette` | **NO** unless coverSrc oscillates |
| `useRenderTracker.js:13-20` | **MISSING deps**; no setState | **NO** |

---

## Top 3 Suspected Loop Sources (file:line)

1. **`src/hooks/useCsCoverTransition.js:28-31`** — unconditional `setDisplaySrc`/`setDisplayType` on every src dep change when `csMode` unchanged  
2. **`src/components/ui/CoverArtCS.js:26-33`** — `csMode = isLocked || csOpacity >= 1` crosses threshold during mobile touch-hold, firing transition while parent `csMode` is still false  
3. **`src/components/audio/GlobalAudioPlayerBar.js:456-510`** — RAF `setCsHoldOpacity` + `setAmbientCoverUrl` during touch-hold stacks with (1)/(2) on iPhone Safari  

---

## Reproduction hints (read-only)

- iPhone Safari: start playback → touch-and-hold mini-player cover (CS hold preview) or double-tap toggle CS  
- Watch for error when `csHoldOpacity` crosses `1.0` or when CS catalog cover URLs hydrate  
- Compare with desktop (no touch-hold path) — matches “desktop works” report
