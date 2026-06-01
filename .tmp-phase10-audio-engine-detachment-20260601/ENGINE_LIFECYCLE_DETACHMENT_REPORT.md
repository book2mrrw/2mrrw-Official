# Engine Lifecycle Detachment Report

## Completed (Phase 10 pass 1)

- [x] `audio-engine-runtime.js` with `getAudioEngineRuntime()` / `getAudioEngineRefs()`
- [x] Detached `<audio>` mounted once on `document.body`
- [x] Command queue + command metadata refs moved to engine ref bag
- [x] Removed provider-owned `<audio>` JSX
- [x] Provider mount effect: engine init + perf marks (single `[]` effect)
- [x] Decoupled audio event listener effect from `authLoading` dependency
- [x] Stable `entitlements:updated` listener (no re-bind on auth loading flip)
- [x] `logPlaybackEngineLifecycle`, `logPlaybackRenderNoImpact` in `playback-trace.js`
- [x] `npm run build` — pass
- [x] `npm run test:playback-resolver-fallback` — 21/21 pass

## Files changed

| File | Change |
|------|--------|
| `src/lib/playback/audio-engine-runtime.js` | **New** singleton runtime |
| `src/context/AudioContext.js` | Engine refs, detached audio, auth/entitlement effect stabilization |
| `src/lib/diagnostics/playback-trace.js` | Phase 10 log helpers + internal frame regex |

## Remains React-coupled (intentional / next pass)

| Piece | Why still in React |
|-------|-------------------|
| `executePlaybackCommand` + all `*Internal` handlers | Large surface; behavior freeze for Phase 10 |
| `useState` playback snapshot | UI subscription model |
| Audio element event `useEffect` | Still re-runs when handler callbacks change (not auth) |
| Web Audio graph refs (`audioCtxRef`, `analyserRef`) | Tied to gesture unlock effect in provider |
| CS hold preview direct `audio.play()` | Documented Phase 8 exclusion |
| `playTrackInternal` deps on `authLoading`, `entitlementAccountState.mediaProgress` | Entitlement restore path; not lifecycle init |

## Risk notes

- **HMR:** Runtime persists on `window`; hot reload may show duplicate mount logs — production single mount only.
- **SSR:** Stub runtime on server; element created only in browser `useEffect`.
- **Testing:** No new automated browser test; build + resolver fallback script used as gate.

## Rollback

Restore `AudioContext.js`, delete `audio-engine-runtime.js`, revert `playback-trace.js` from foundation anchor.
