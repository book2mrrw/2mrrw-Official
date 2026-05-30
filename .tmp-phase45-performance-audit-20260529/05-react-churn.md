# 05 — React Churn (Render Hotspots)

## Critical hotspot: AudioContext progress RAF

**File:** `src/context/AudioContext.js` L532–548

```javascript
const startProgressRaf = useCallback(() => {
  const tick = () => {
    // ...
    if (Math.abs(t - prev.currentTime) >= 0.001) {
      patchState({ currentTime: t });  // setState every animation frame
    }
    progressRafRef.current = requestAnimationFrame(tick);
  };
}, [patchState, stopProgressRaf]);
```

**Context value** spreads full `state` into provider value (L2868–2904) with `state` in useMemo deps — **any state field change re-creates context value**.

### Downstream subscribers (`useAudioPlayer`)

~25 files consume context including:
- `src/app/page.js` (3 calls)
- `src/components/audio/GlobalAudioPlayerBar.js`
- `src/components/music/MyMusicTab.js`
- `src/components/music/ReleaseCardPlayButton.js`
- `src/media/useMediaEngine.js`

**Impact:** During playback, ~60 context updates/sec → potential 60 re-renders/sec across all consumers unless memoized.

## Page-level hotspots

### `src/app/page.js` (~2,778 lines)

| Trigger | Mechanism | Frequency |
|---------|-----------|-----------|
| Scroll | `setHeroScrollY` | Every scroll event |
| Audio progress | `useAudioPlayer()` state | ~60 fps while playing |
| Tab change | `activeTab` state | User action |
| Catalog fetch | Multiple useState sets | Mount + pagination |
| Modal open | preview/album state | User action |

Single `export default function Page()` — no split subcomponents with `memo` at tab boundaries.

## AuthContext updates

**File:** `src/context/AuthContext.js`
- `refreshAccountState` updates `accountState`, `library`, `ownedSlugs` atomically via `applyAccountPayload`
- `useEntitlementAccountState` memoizes empty state during loading (L442–447) — good
- Page uses both `useAuth()` and `useEntitlementAccountState()` — double subscription

## GlobalAudioPlayerBar

**File:** `src/components/audio/GlobalAudioPlayerBar.js`
- Uses `useRenderTracker` (dev-only render counting)
- Subscribes to audio context for scrubber — re-renders with `currentTime`

## framer-motion

AnimatePresence + motion.div throughout `page.js` — layout animations on hero, sheets, modals. Motion reads layout each frame when animating.

## Findings

1. **Progress RAF + context value coupling** — #1 React churn source.
2. **Page subscribes to full audio state** for `isPlaying`, `pause`, etc. — could use selectors.
3. **Scroll-driven setState** — #2 churn source on Home tab.
4. **No React Compiler** — manual memo sparse outside skeletons/player bar.

## Validation checklist

- [ ] React DevTools Profiler: record 5s playback — count Page commits
- [ ] `@welldone-software/why-did-you-render` spot check on Page (dev only)
