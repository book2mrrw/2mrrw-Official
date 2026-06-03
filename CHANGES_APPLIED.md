# Mobile Remount + Audio Fix — Changes Applied

**Prompt:** SURGICAL FIX — iOS Wake → Remount + Dead-Audio (`MOBILE_REMOUNT_AUDIO_FIX_PROMPT.md`)  
**Audit source:** `MOBILE_REMOUNT_AUDIO_AUDIT.md`  
**Date:** 2026-06-03

## Checkpoint and final commit

| Role | SHA | Notes |
|------|-----|-------|
| Restore point (checkpoint) | `594c970` | Empty checkpoint before edits |
| Fix commit | `9768269` | Fix 1 only (`AudioContext.js`) |
| Doc alignment | `9462032` | `CHANGES_APPLIED.md` SHA line only |

## Phase 0 — Failure 1 branch selection

**Status: BLOCKED — not run on physical iPhone Safari.**

The prompt requires device reproduction with a temporary `[NAV]` / `[PAGESHOW persisted]` probe before any Failure 1 (Fix 2A/2B) edit. This pass did **not** add the probe to shipped code and did **not** implement Fix 2.

| Observation | Value |
|-------------|-------|
| `[NAV] type` | *Not collected* |
| `[PAGESHOW persisted]` | *Not collected* |
| Branch selected | **None** — Fix 2 deferred |

**Next step for parent/agent:** Deploy preview → run Phase 0 protocol on iPhone → select Branch A or B → follow-up pass for Fix 2 only.

## Fix 1 — Failure 2 (dead audio after wake) — SHIPPED

### Re-verification vs audit quotes

All cited regions were re-opened in `src/context/AudioContext.js` before edit. Line numbers shifted slightly after insertions; mechanisms matched the audit.

### Per-change log

| Change | File:region | Audit match? | Mechanism |
|--------|-------------|--------------|-----------|
| **1.1** Sync gesture resume before queue | `AudioContext.js` — `resumeWebAudioContextFromUserGesture`, `dispatchPlaybackCommand`, `playTrack`, `resume` | Yes (`5446-5447`, `5333+`) | `ctx.resume()` invoked synchronously in the tap handler stack before `commandQueueRef` microtask and before stream `await`s. |
| **1.2** Block play when ctx not running | `playTrackInternal` WEB_AUDIO gate | Yes (`3032-3056`, `audibility.js:105`) | Removed continue-anyway path; returns `false`, sets `error: "Tap play to continue."`, diagnostic `WEB_AUDIO_SUSPENDED_BLOCKED_PLAY`. `resumeInternal` also blocks `audio.play()` when ctx not running. |
| **1.3** Re-arm gesture unlock on suspend | `unlockFromGesture` effect | Yes (`2061-2094`) | Unlock runs when `sessionUnlocked` **or** `audioCtx.state === "suspended"`; listeners removed only when ctx reaches `"running"`. |
| **1.4** Reconnect graph after hard recover | `initWebAudio`, `recoverAudioHard` | Yes (`1985-1988`, `3933+`) | Downstream reconnect when `sourceRef` exists but graph torn down; stale `MRRW_MEDIA_SOURCE_BOUND` without `sourceRef` attempts symbol clear + `createMediaElementSource` or direct fallback; `recoverAudioHard` explicit `connectWebAudioDownstream` after teardown. |

## Fix 2 — Failure 1 (remount / reload illusion)

**Not applied** — gated on Phase 0 device branch (prompt §PHASE 0, §FIX 2).

## Verification protocol (physical iPhone)

| Step | Result | Notes |
|------|--------|-------|
| 1. Load → play single 1 | **Pending** | Requires preview + iPhone |
| 2. Dim 30s → wake, no reload | **Pending** | Fix 2 not in this pass |
| 3. Play single 2 audible | **Pending** | Fix 1 target |
| 4. Repeat dim→wake 3× | **Pending** | |
| 5. Lock-screen controls | **Pending** | Must-not-regress: Media Session untouched |
| 6. Background → return | **Pending** | |
| 7. Phase-0 probe removed | **N/A** | Probe never added to repo |

## Must-not-regress confirmation

| System | Touched? |
|--------|----------|
| `navigator.mediaSession` handlers (`5587-5654`) | **No** |
| Background-audio lifecycle (Phases 19–21) | **No** structural change; visibility path unchanged |
| Entitlement stream / 30s preview | **No** |
| Immersive modal command authority | **No** |
| CS/Slowed toggle | **No** |
| Gifting/ownership | **No** |

## Second bugs (report only, not fixed)

- Failure 1 (visibility hard recover + storefront `ensureStorefrontCarouselMedia` thrash) — awaiting Phase 0 branch.
- Possible `AudioContext` closed while `MediaElementSource` from prior ctx retained — partial mitigation via `ctx.state === "closed"` source clear in `initWebAudio`; needs device validation.

## Build / guardrails

- `npm run build` — **pass**
- `npm run check:frontend-guardrails` — **pass** (0 errors, 3 pre-existing `page.js` marker warnings)

## Files changed

- `src/context/AudioContext.js` — Fix 1 (1.1–1.4)
- `CHANGES_APPLIED.md` — this report

## Deploy

**Y** — preview deploy recommended for iPhone verification of Fix 1 and Phase 0 before Fix 2.
