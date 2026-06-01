# Playback Render Decoupling Matrix

| Trigger | Touches engine element? | Re-binds audio listeners? | Mutates playback via command? | Phase 10 mitigation |
|---------|-------------------------|---------------------------|-------------------------------|---------------------|
| Auth `loading` flip | No | **Was yes** (auth in deps) | No | `authLoadingRef`; removed from listener deps |
| User id change | No | No | No | `listeningUserIdRef` only |
| Entitlement account hydrate | No | No | Only via `entitlements:updated` event | Stable listener + `dispatchPlaybackCommandRef` |
| Provider re-render (auth only) | No | No | No | `[PLAYBACK-RENDER-NO-IMPACT]` trace |
| `dispatchPlaybackCommand` | Yes (via executor) | No | Yes | Queue on engine `commandQueueRef` |
| Provider unmount (layout) | **Retained** | Teardown listeners | No | Element stays on `document.body` |
| Viewport pause/resume | Yes | No | Yes (`VIEWPORT_*` commands) | Unchanged Phase 8 |
| Visibility hidden/visible | Yes | No | Recover via command in handler | Unchanged |

## State of truth (post Phase 10)

| State | Authority |
|-------|-----------|
| `audio.paused`, `currentTime`, `src` | **DOM / engine element** |
| `stateRef` / `useState` | **React bridge** (synced from events + commands) |
| Command ordering | **Engine `commandQueueRef`** |
| UI entitlement display | **AuthContext / account state** (not playback init) |
