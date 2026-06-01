# Phase 5.2.7 — Profiling Methodology

**Policy this phase:** Skip long browser waits. Document procedure; defer iOS/Android to device runs.

---

## Desktop Chrome (localhost dev)

### Prerequisites

1. `npm run dev` — must be `NODE_ENV=development` (marks are no-op in production).
2. Chrome 120+ with DevTools open (Console + Performance optional).
3. Throttle **off** for baseline; repeat with **Fast 3G** or **Slow 4G** to stress network stages.

### Procedure

1. Open `http://localhost:3000` (or LAN IP for phone-adjacent testing).
2. **Prime gesture unlock:** one tap anywhere on page (activates `sessionUnlockedRef`, Web Audio resume).
3. Navigate to home catalog; ensure at least one playable release card is visible.
4. Clear console.
5. Tap **Play** on a release card (guest preview path) or entitled stream if logged in.
6. On first `playing` event, `dumpPlaybackTiming()` runs automatically. Or manually:

```javascript
window.dumpPlaybackTiming()
```

7. Copy `formattedWaterfall`, `measures`, and `elementEvents` from console or:

```javascript
copy(JSON.stringify(window.__2mrrwLastPlaybackTiming, null, 2))
```

### Repeat scenarios (recommended matrix)

| Scenario | Purpose |
|----------|---------|
| Cold first play (hard refresh) | Full decode + network |
| Second play same track | Same-src fast path (`readyState >= 2`) |
| Switch track while playing | Cross-track fade + new src |
| Entitled library stream | Resolver + signed URL + HEAD stages |
| Redirect fast path (`redirect=1`) | Skip JSON resolver marks |

### Chrome Performance panel (optional overlay)

1. Record → tap play → stop at audible.
2. Correlate Main thread gaps with `playback-resolver` and `playback-src-to-loadeddata` measure windows.
3. Network tab: filter `media`, `library/stream`, CDN host — align with `PLAYBACK_SRC_ASSIGN` offset.

### Expected mark presence by path

| Path | Resolver marks | Notes |
|------|----------------|-------|
| Guest preview (R2/public) | Absent | TAP → REQUEST → SRC_ASSIGN → … |
| Library redirect (`redirect=1`) | Absent | Browser loads same-origin proxy directly |
| Entitled signed stream | Present | RESOLVER_START → SIGNED_URL before SRC_ASSIGN |
| Background stream resolve | Present (async) | May appear after first audible on redirect path |

---

## iOS Safari — **requires-device-run**

Not executed in Phase 5.2.7 (no simulator soak).

### Device procedure

1. Mac: Safari → Develop → [device] → 2MRRW dev URL (or TestFlight build with dev bundle — **not available in prod**).
2. **Alternative:** Use Eruda or remote Web Inspector with `npm run dev` on LAN.
3. Tap play; in console: `dumpPlaybackTiming()` if dev build.
4. Capture: `totalTapToAudibleMs`, `audioContextState.state` (expect `running` after gesture), `waiting`/`stalled` counts in `elementEvents`.

### iOS-specific watch items

- Gesture unlock + ephemeral AudioContext (`ephemeral-unlock` label).
- `audio.play()` promise rejection before user gesture (marks stop at `AUDIO_PLAY_CALL`).
- Background tab suspend → `suspend` element events.
- Bluetooth / lock-screen handoff (Media Session) — audible mark may lag `play()` promise.

---

## Android Chrome — **requires-device-run**

Not executed in Phase 5.2.7.

### Device procedure

1. USB debug → `chrome://inspect` → inspect WebView/tab.
2. Same tap → `dumpPlaybackTiming()` flow as desktop.
3. Test with **Data Saver** off and on.

### Android-specific watch items

- `audio.load()` in gesture unlock path.
- Aggressive tab discarding — provider remount (`PLAYBACK_PROVIDER_MOUNT` gap).
- Codec path differences (AAC vs MP3) affecting decode segment duration.

---

## Prod / staging note

**Marks do not run in production builds.** For prod latency, use:

- Phase 5.2.4 curl baselines (`/api/library/stream`, `/api/account/state`)
- RUM / `logPlayback` server events (existing observability)
- Device runs with dev build or future gated staging flag (out of scope)

---

## What was skipped this phase

- Multi-minute browser soak loops
- iOS physical device capture
- Android physical device capture
- Lighthouse / WebPageTest automation

All skipped items are documented above for the next operator.
