# Playback Authority Enforcement Map — Phase 8

```mermaid
flowchart TB
  subgraph external [External callers]
    UI[Components / page.js]
    Bridge[AudioPhase10Bridge]
    Events[entitlements:updated]
    AV[exitAudioVisualViewport]
  end

  subgraph authority [Single authority]
    DPC[dispatchPlaybackCommand]
    Q[commandQueueRef serial chain]
    EPC[executePlaybackCommand]
  end

  subgraph internal [Internal executors only]
    PTI[playTrackInternal]
    PQI[playQueueInternal]
    SQI[setQueueInternal]
    PI[pauseInternal]
    RI[resumeInternal]
    SI[seekInternal]
    STI[stopInternal]
    UTS[upgradeToFullStream]
    RSP[retryStreamPlayback]
    RFV[resumeFromViewport]
  end

  UI -->|playTrack pause resume seek playQueue stop| DPC
  Bridge -->|setQueue alias| DPC
  Events -->|UPGRADE_STREAM| DPC
  AV -->|VIEWPORT_RESUME| DPC
  DPC --> Q --> EPC
  EPC --> PTI & PQI & SQI & PI & RI & SI & STI & UTS & RSP & RFV
  PQI --> SQI
  RFV --> RI
```

## Authority tiers

| Tier | Role | May mutate `<audio>` / queue? |
|------|------|------------------------------|
| **1 — Command queue** | `dispatchPlaybackCommand` | Yes (serialized) |
| **2 — Element listeners** | `onPause`, `onPlay`, stall recovery | Reactive only; may call `dispatchPlaybackCommand(RECOVER)` |
| **3 — Viewport (6B)** | `enterAudioVisualViewport` / `exit` | Pause/resume via **Tier 1** (`VIEWPORT_*` commands) after Phase 8 |
| **4 — UI shadow state** | `page.js` `nowPlaying` | Display only — not authoritative |

## Enforcement mechanism

1. All new mutations should use `dispatchPlaybackCommand` or public wrappers.
2. `*Internal` functions log `[PLAYBACK-AUTH-VIOLATION]` when called with `commandExecutionDepthRef === 0` and trace enabled.
3. No runtime blocking — soft migration + observability only.
