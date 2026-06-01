# Phase 6C — Playback Interruption Root-Cause Trace

Instrumentation only. **No playback, pause, resume, viewport, entitlement, or queue behavior changes.**

## Enable / disable

| Flag | Effect |
|------|--------|
| `NODE_ENV=development` | Trace on (default local dev) |
| `NEXT_PUBLIC_PLAYBACK_TRACE=1` | Trace on in any build |
| `NEXT_PUBLIC_PLAYBACK_TRACE=0` | Force off |

Related (unchanged): `NEXT_PUBLIC_STATE_CHURN_LOG` for `[state-churn]` / `[playback-resilience]`.

## Module

`src/lib/diagnostics/playback-trace.js`

- `logPlaybackEvent({ type, source, stack, trackId, timestamp, extra })` — ring buffer (10), console `[playback-event]`
- `capturePlaybackSnapshotOnPause(...)` — console `[playback-stop-snapshot]`
- `classifyPlaybackInterruption(evidence)` — console `PLAYBACK INTERRUPTION CLASSIFICATION:`
- `logAudioProviderRender`, `logUiChurn`, `logStreamLifecycle`
- `recordPlaybackTraceContext` / `getPlaybackTraceContext` — cross-layer timestamps (scroll, entitlements, visibility, catalog)

## Instrumented call sites

### AudioContext (`src/context/AudioContext.js`)

| Event type | When |
|------------|------|
| `pauseInternal` | User/command pause path |
| `pauseForViewport` | Viewport pause |
| `resumeInternal` | Resume |
| `seekInternal` | Seek |
| `stopInternal` | Stop / teardown |
| `trackChange` | `playTrackInternal` start |
| `queueReset` | `setQueue` |
| `upgradeToFullStream` | Full stream upgrade |
| `recovery` | Stall recovery, `RECOVER` command |
| `pause` / `pauseSkipped` | Native `pause` event |
| `visibility` | `visibilitychange` |

On **unexpected** pause (`!userInitiated && !viewport`): snapshot + classification.

### page.js

- `[ui-churn] scroll` — throttled 300ms on main scroll
- `[ui-churn] intersection` — Audio Visuals + home vault/cards/shows
- `[ui-churn] section-change` — tab changes
- `[ui-churn] catalog-rerender` — browse singles / catalog load

### stream-client (`src/lib/playback/stream-client.js`)

- `[stream-lifecycle]` — `start`, `abort`, `ready`, `replace` (clear session)
- `waitAudioSrcReady` — `src-swap`, `abort` (AudioContext)

## Reading logs (Safari / Chrome devtools)

Filter console by prefix:

1. `[playback-event]` — ordered causal chain (check `type`, `source`, `trackId`)
2. `[playback-stop-snapshot]` — full stop context + `lastEvents` + `traceContext`
3. `PLAYBACK INTERRUPTION CLASSIFICATION` — hypothesis:
   - **A** — viewport / focus / scroll / Audio Visuals
   - **B** — auth / entitlement hydration
   - **C** — stream URL / src swap / preview fallback
   - **D** — React churn (catalog render, visibility, re-renders)
4. `[render-churn]` — AudioProvider renders (`reasonGuess`, `changed` deps)
5. `[ui-churn]` — shell scroll / IO / tabs / catalog
6. `[stream-lifecycle]` — signed URL pipeline

### Typical investigation flow

1. Reproduce interruption while devtools open.
2. Find last `[playback-event]` before stop.
3. Open matching `[playback-stop-snapshot]` — compare `traceContext.lastScrollAt`, `lastEntitlementUpdateAt`, `lastCatalogRenderAt`.
4. Read classification `likelyCause` + `evidence` array.
5. Correlate `[render-churn]` / `[ui-churn]` timestamps within ~500ms of stop.

## Files touched (implementation)

- `src/lib/diagnostics/playback-trace.js` (new)
- `src/lib/diagnostics/state-churn-log.js` (re-export)
- `src/context/AudioContext.js`
- `src/app/page.js`
- `src/lib/playback/stream-client.js`
