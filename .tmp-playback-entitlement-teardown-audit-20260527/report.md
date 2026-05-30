# Playback Entitlement Teardown Audit — Executive Report

**Date:** 2026-05-27  
**Repo:** `/Users/recharge/artist-platform` (+ Control System handler read)  
**Scope:** Read-only — playback starts, ~1–2s audible, timeline jumps to end, terminates. Failing endpoint observed: `/api/playback/events`.  
**Constraint:** No code changes, no commits.

---

## Executive summary

The failing **`POST /api/playback/events`** is **real** but **not causal** for playback termination. Browser same-origin URL rewriting sends telemetry to the storefront (`404`), while Control System accepts the same payload (`200`). AudioContext fires this request fire-and-forget on play/progress and **never branches on success or failure**.

The **~1–2 second** stop pattern aligns with two **in-engine** mechanisms:

1. **Deferred resume seek** — saved `mediaProgress` or localStorage position applied after `loadedmetadata`, jumping to near track end then firing native `ended`.
2. **Release card 2s upgrade timer** — `upgradeToFullStream()` reloads `audio.src` exactly 2000ms after entitled card play, aborting the current decode.

Neither path bypasses entitlements. Both are continuation/upgrade logic side effects, not CORS or AudioContext silence issues.

---

## Top 3 ranked root causes

| Rank | Hypothesis | Confidence | Termination trigger |
|------|------------|------------|---------------------|
| 1 | Saved progress resume seek near end | 0.82 | `ended` → `onEnded` after `applyPendingSeek` |
| 2 | 2s `upgradeToFullStream` src reload (Release card) | 0.78 | `ended` / `error` after `waitAudioSrcReady` |
| 3 | playback/events 404 (telemetry misroute) | 0.95 non-causal | **None** — correlated only |

---

## `/api/playback/events` finding

| Aspect | Detail |
|--------|--------|
| Caller | `sendControlSystemPlaybackEvent` from `AudioContext.persistPlayback` |
| Storefront route | **Missing** — 404 on production |
| Control System route | `2MRRW-Control-System/src/app/api/playback/events/route.ts` — analytics only |
| Role | Telemetry + durable progress on CS; **not** entitlement validator |
| Teardown link | **None** |

**Root of 404:** `buildControlSystemUrl` same-origin rewrite for browser `/api/*` paths (`client.js:39-51`).

---

## Entitlement lifecycle (condensed)

```
toPlaybackTrack → resolveTrackAccess → resolvePlaybackSrc
  → playTrack → syncSrc (preview CDN | library redirect)
  → optional background fetchLibraryStream / upgradeToFullStream
  → persistPlayback → /api/media/playback + /api/playback/events
```

Server gate: `userCanStreamProduct` on `/api/library/stream` (403/401). Client metadata can lag auth hydration; modal play defers until `authLoading` false.

---

## Preview enforcement

- Hard cap: **30s** (`PREVIEW_HARD_CAP_SEC`) — does not explain 1–2s stop.
- Guest/default: `previewOnly: true`, public R2 preview URL.
- Upgrade paths: `entitlements:updated`, `upgradeToFullStream`, `swapToSignedStream`.

---

## Exact termination trigger (code)

**Primary handler:** `HTMLAudioElement` **`ended`** event → **`onEnded`** in `AudioContext.js:690-775`.

**Most likely precursors for reported symptom:**
- `applyPendingSeek` at `1283-1291` (saved position near duration)
- `upgradeToFullStream` → `waitAudioSrcReady` at `1363` (~2s after Release card play)

**Not a trigger:** `/api/playback/events` response status.

---

## Production probes (safe)

```
OPTIONS https://www.2mrrw.com/api/playback/events → 204
POST    https://www.2mrrw.com/api/playback/events → 404 (HTML)
POST    https://2mrrw-control-system.vercel.app/api/playback/events → 200 JSON
```

---

## Deliverables

| File | Content |
|------|---------|
| `01-auth-lifecycle.md` | Play → entitlement → stream → session flow |
| `02-playback-events-role.md` | Telemetry vs validator; 404 analysis |
| `03-preview-enforcement.md` | 30s cap, guest, auth transitions |
| `04-session-state.md` | Session IDs, races, refresh |
| `05-termination-paths.md` | All AudioContext stop/seek paths |
| `06-auth-continuity.md` | Cookie refresh, account state side effects |
| `07-root-cause-ranked.md` | Ranked hypotheses + decision tree |
| `manifest.txt` | File index |

**Zip:** `/Users/recharge/Downloads/playback-entitlement-teardown-audit-20260527.zip`

---

## Out of scope (per user)

- No AudioContext redesign
- No entitlement bypass
- No code fixes applied

Recommended fix tracks (for future, not this audit):
1. Telemetry: CS absolute URL or storefront proxy for `/api/playback/events`
2. Playback: guard 2s upgrade when redirect path already playing; validate resume position vs duration before seek
3. Repro: clear saved progress when user taps play from start (product decision)
