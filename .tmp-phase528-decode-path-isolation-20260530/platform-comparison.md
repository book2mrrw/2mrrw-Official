# Phase 5.2.8 — Platform Comparison

**Policy:** Document methodology; label **measured** vs **requires-device-run**. No long browser soak in this phase.

---

## Desktop Chrome (localhost dev)

**Status:** **Methodology ready** — live numeric dump not captured in agent run (no dev server soak).

### Procedure

1. `npm run dev` → `http://localhost:3000`
2. DevTools Console → tap play → `window.dumpPlaybackTiming()`
3. Record `scenario`, `decodePathBreakdown`, `readyStateAnalysis`

### Expected decode bucket (guest preview cold, synthetic)

| Segment | ms |
|---------|-----|
| src → loadedmetadata | 80–250 |
| loadedmetadata → loadeddata | 40–180 |
| loadeddata → canplay | 0–50 |
| canplay → play() | 100–200 |
| play → promise | 1–20 |
| promise → audible | 0–30 |

**Chrome-specific:** MSE/HTMLMediaElement; aggressive HTTP/2 cache; canplaythrough often fires before play().

---

## iOS Safari

**Status:** **requires-device-run**

### Procedure

1. Mac Safari → Develop → [iPhone/iPad] → LAN dev URL
2. Tap play; `dumpPlaybackTiming()` in Web Inspector console
3. Capture `audioContextState.state` (expect `running` after gesture)

### Expected differences vs Chrome (literature + 5.2.7)

| Segment | iOS vs Chrome |
|---------|---------------|
| src → loadedmetadata | +20–80 ms (cell/WiFi variance) |
| loadedmetadata → loadeddata | +30–100 ms (AAC hardware path) |
| play → promise | Higher rejection risk pre-gesture |
| promise → audible | +10–40 ms (output route / BT) |

**Watch:** `waiting`/`stalled` during HAVE_METADATA; `suspend` on background tab.

---

## Chrome Android

**Status:** **requires-device-run**

### Procedure

1. USB debug → `chrome://inspect`
2. Same tap → dump flow

### Expected differences

| Segment | Android vs desktop |
|---------|-------------------|
| src → loadedmetadata | +50–150 ms on Slow 4G |
| loadedmetadata → loadeddata | Codec-dependent (AAC vs MP3) |
| Provider remount | Tab discard → cold-start replay |

**Watch:** Data Saver may increase NETWORK_LOADING dwell.

---

## Samsung Internet

**Status:** **requires-device-run**

### Procedure

Same as Chrome Android via remote inspect (Chromium-based).

### Expected differences

| Area | Note |
|------|------|
| Decode | Similar to Chrome Android; vendor power saving may delay `audio.load()` |
| Cached playback | Same-src fast path should match Chromium behavior |
| Background | Aggressive suspend → higher `suspendCount` |

---

## Cross-platform summary table

| Platform | E2E cold (ms) | Decode bucket (ms) | Measured this phase |
|----------|---------------|--------------------|---------------------|
| Desktop Chrome | 320–830 | 220–680 | **Methodology only** |
| iOS Safari | 400–950 | 250–750 | **requires-device-run** |
| Chrome Android | 380–900 | 240–720 | **requires-device-run** |
| Samsung Internet | 380–900 | 240–720 | **requires-device-run** |

---

## TOP 3 delays — platform notes

1. **src → loadedmetadata (80–250 ms desktop)** — Network + demux; highest on mobile Slow 4G (+50–150 ms).
2. **loadedmetadata → loadeddata (40–180 ms)** — Decode; iOS AAC path often +30–100 ms vs desktop.
3. **canplay → play() (100–200 ms)** — Includes canplaythrough wait; iOS may add output-route delay before audible.

---

## Prod note

Marks are **dev-only** (`NODE_ENV=development`). Production latency requires RUM / Phase 5.2.4 curl baselines or future gated staging flag.
