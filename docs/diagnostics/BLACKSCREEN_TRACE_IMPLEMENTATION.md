# Phase 13 — Black Screen Forensic Tracing (Temporary)

Diagnostics-only instrumentation for investigating black-screen / blank-view incidents. **No playback, viewport, entitlement, or stream behavior changes** when the flag is off.

## Enable

```bash
NEXT_PUBLIC_BLACKSCREEN_TRACE=1 npm run dev
```

Client runtime gate: `process.env.NEXT_PUBLIC_BLACKSCREEN_TRACE === '1'`.

## Console prefixes

| Prefix | Category |
|--------|----------|
| `[BLACKSCREEN-ERROR]` | `window.onerror`, `unhandledrejection` |
| `[BLACKSCREEN-DUMP]` | Ring buffer dump (100 events) |
| `[BLACKSCREEN-NAV]` | Route / history changes |
| `[BLACKSCREEN-LIFECYCLE]` | visibility, pagehide, pageshow, beforeunload, freeze, resume, online, offline |
| `[BLACKSCREEN-AUTH]` | AuthContext snapshot changes, `entitlements:updated` |
| `[BLACKSCREEN-PLAYBACK]` | Playback command completion (via correlation hook) |
| `[BLACKSCREEN-MOUNT]` | Component mount/unmount counters |
| `[BLACKSCREEN-SCROLLRESET]` | Scroll drop from >200 to <20 (no beforeunload) |

## Files touched

| File | Role |
|------|------|
| `src/lib/diagnostics/blackscreen-trace.js` | Core ring buffer, global handlers, scroll/history |
| `src/lib/diagnostics/useBlackscreenMountTrace.js` | Shared mount `useEffect` hook |
| `src/lib/diagnostics/playback-trace.js` | `registerBlackscreenPlaybackCorrelation` / `correlateBlackscreenPlayback` |
| `src/components/system/BlackscreenTraceBootstrap.js` | Client init, nav, auth subscription |
| `src/app/layout.js` | Mount `<BlackscreenTraceBootstrap />` |
| `src/context/AudioContext.js` | Mount trace + `correlateBlackscreenPlayback` in command `finally` |
| `src/app/page.js` | Mount trace + `data-main-scroll` on main scroller |
| `src/components/audio/GlobalAudioPlayerBar.js` | Mount trace |

## Reproduce / verify

1. Set `NEXT_PUBLIC_BLACKSCREEN_TRACE=1` in `.env.local` (or inline for one run).
2. `npm run dev` — open home on mobile or desktop.
3. Open DevTools → Console; filter by `BLACKSCREEN`.
4. Navigate tabs, play/pause, background the tab, trigger checkout entitlement update — confirm prefixed logs.
5. Force an error in console (`throw new Error('test')`) — confirm `[BLACKSCREEN-ERROR]` and `[BLACKSCREEN-DUMP]`.
6. Scroll main catalog >200px then programmatic or UI jump to top — watch for `[BLACKSCREEN-SCROLLRESET]` when not unloading.

## Ring buffer

- Last **100** events across categories stored in memory.
- Dumped automatically on: global error, unhandled rejection, root layout unmount/remount.

## Disable

Unset the env var or set any value other than `1`. No console noise; mount hooks no-op.
