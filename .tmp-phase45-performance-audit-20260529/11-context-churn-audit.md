# 11 — Context Churn Audit (Playback / Auth / Queue / Progress Rerenders)

## Context inventory

| Context | File | Consumers | Update frequency |
|---------|------|-----------|------------------|
| AudioContext | `src/context/AudioContext.js` | ~25 files | **~60/s during playback** (progress RAF) |
| AuthContext | `src/context/AuthContext.js` | Widespread | Low–medium (login, purchase, refresh) |
| AuthGateContext | `src/context/AuthGateContext.js` | AuthGate | Low |
| CartContext | `src/app/context/CartContext.js` | Checkout flows | Low |

## AudioContext value shape

```javascript
const value = useMemo(() => ({
  ...state,  // includes currentTime, duration, isPlaying, queue, etc.
  playTrack, playQueue, pause, resume, /* 20+ methods */
}), [state, /* all callbacks */]);
```

**Problem:** `currentTime` in `state` changes every RAF tick → entire value object changes → all consumers re-render.

### State fields in `state` object (high churn)

- `currentTime` — every frame while playing
- `duration` — occasional
- `isPlaying`, `isBuffering` — play/pause transitions
- `queue`, `currentTrack` — track changes
- `previewEnded`, `streamConflict` — edge cases

## AuthContext value shape

**File:** `src/context/AuthContext.js` L390–430

Includes: `user`, `library`, `ownedSlugs`, `accountState`, `loading`, `authStatus`, methods.

**Updates on:**
- Session bootstrap
- `/api/account/state` response
- Sign in/out
- `refreshLibrary` / `refreshAccountState`

**Good pattern:** `useEntitlementAccountState()` returns frozen `EMPTY_ACCOUNT_STATE` while loading.

## Queue updates

Queue stored in AudioContext state — queue mutations trigger full context update (not separate store).

**Alternative present but unused for progress:** zustand in dependencies (`package.json` L42) — `modalStackStore.js` uses it; audio does not.

## Progress without context (partial patterns)

- `stateRef.current` used internally for RAF comparison (L541) — ref updated but still calls patchState
- `audioRef` exposed in context value — escape hatch for direct DOM access

## GlobalAudioPlayerBar

Subscribes to full context — scrubber re-renders every frame. Could read `currentTime` from ref callback or subscribe pattern.

## Findings

1. **Split progress from command context** — highest-value context optimization.
2. **Auth context broadly subscribed in page.js** — pairs with audio churn for maximum re-render surface.
3. **zustand available** — could host progress/queue without provider churn (future consideration).
4. **useMemo on callbacks** in AudioContext is thorough — but negated by state dep.

## Validation checklist

- [ ] Profiler: isolate GlobalAudioPlayerBar vs Page render count during 10s playback
- [ ] Count React commits when paused vs playing (should drop to ~0 when paused)
