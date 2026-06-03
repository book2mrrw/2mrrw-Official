# CORRECTION — Restore audio CONSTRUCTION to baseline, keep V2 wake/rotation/memory fixes

**Prompt:** `CORRECTION_RESTORE_AUDIO_CONSTRUCTION_PROMPT.md`  
**Baseline construction:** `594c970`  
**Prior wake fix:** `9768269`  
**V2 full fix:** `36fab23`–`6651f5a` + docs `5e1309d`  
**Date:** 2026-06-03

## Checkpoint and commit

| Role | SHA | Subject |
|------|-----|---------|
| Checkpoint (pre-correction) | `5e1309d` | `docs: CHANGES_APPLIED_V2 for wake audio rotation full fix` |
| **This correction** | `4a0b8c4` | `fix(playback): restore baseline Web Audio construction (V3 correction)` |

## What changed vs prior wake / V2 pass

V2 (`CHANGES_APPLIED_V2.md`) intentionally left `initWebAudio` / graph wiring unchanged. That was incorrect relative to baseline `594c970`: Pass-1 construction (on top of `9768269`) had already introduced:

1. **`needsDownstreamReconnect`** — allowed re-entry when `webAudioInitializedRef` was false but source existed.
2. **Closed-context source nulling** — `if (ctx?.state === "closed") { sourceRef.current = null; }` before creating a new `AudioContext`.
3. **Second `createMediaElementSource`** — on bound element without `sourceRef`, deleted `MRRW_MEDIA_SOURCE_BOUND` and called `createMediaElementSource` again (spec throws `InvalidStateError`; element stays silent).
4. **`recoverAudioHard:graph-reconnect`** — extra `connectWebAudioDownstream` when init left graph uninitialized.

**This pass restores baseline construction only.** Fixes A/B/C/D are untouched.

| Fix | SHA | Touched? |
|-----|-----|--------|
| A — skip hard recovery on intact wake | `36fab23` | **No** |
| B — gesture resume, continue play on suspend | `c728863` | **No** (kept `resumeWebAudioContextFromUserGesture` in `recoverAudioHard`) |
| C — rotation carousel no-op | `b9adb5e` | **No** |
| D — idle memory trim | `6651f5a` | **No** |

## `initWebAudio` — removed risky logic (vs pre-correction HEAD)

```diff
-    const needsDownstreamReconnect =
-      sourceRef.current &&
-      audioCtxRef.current?.state !== "closed" &&
-      !webAudioInitializedRef.current;
-    if (webAudioInitializedRef.current && !needsDownstreamReconnect) return;
+    if (webAudioInitializedRef.current || typeof window === "undefined") return;

-      if (ctx?.state === "closed") {
-        sourceRef.current = null;
-        source = null;
-      }

         } else if (!sourceRef.current) {
-          try { delete audio[MRRW_MEDIA_SOURCE_BOUND]; } catch { ... }
-          try { source = ctx.createMediaElementSource(audio); ... } catch { return; }
+          webAudioAvailableRef.current = false;
+          webAudioInitializedRef.current = false;
+          return;
         }
```

## `recoverAudioHard` — removed graph-reconnect only

```diff
-        if (sourceRef.current && audioCtxRef.current?.state !== "closed" && !webAudioInitializedRef.current) {
-          connectWebAudioDownstream(audioCtxRef.current, sourceRef.current);
-          recordAudioContextState(audioCtxRef.current, "recoverAudioHard:graph-reconnect");
-        }
```

`resumeWebAudioContextFromUserGesture` before `resumeWebAudioContextIfSuspended` **retained** (Fix B).

## `connectWebAudioDownstream`

Unchanged — matches baseline `594c970` (`1980–1999` region).

## HARD RULES — confirmation

| Rule | Status |
|------|--------|
| `createMediaElementSource` at most once per `<audio>` element | **OK** — single call site; no delete-flag-then-recreate |
| Main `AudioContext` never `.close()` | **OK** — only ephemeral unlock ctx closes (~2138) |
| No context+element rebuild path added | **OK** |
| Fixes A/B/C/D not reverted | **OK** |

## Files

| File | Change |
|------|--------|
| `src/context/AudioContext.js` | Restore baseline `initWebAudio`; remove `recoverAudioHard:graph-reconnect` |
| `CHANGES_APPLIED_V3.md` | This report |

## Ear-test acceptance (§4 — device required)

| Step | Result |
|------|--------|
| 1. Cold load → play → sound | **PENDING** — agent cannot run by-ear |
| 2. Dim ~30s → wake → sound / second track | **PENDING** |
| 3. Home 2–3 min → return → play → sound | **PENDING** — **critical** for closed-context case |
| 4. Rotate while playing | **PENDING** |
| 5. Lock screen + background/return | **PENDING** |

If step 3 is silent after this correction: **revert this commit** (back to V2) and report — do not add re-bind improvisation.

## Build / guardrails

| Check | Result |
|-------|--------|
| `npm run build` | **PASS** (Next.js 16.2.4) |
| `npm run check:frontend-guardrails` | **PASS** — 0 errors, 3 pre-existing `page.js` warnings |

## Deploy

**No** — correction committed locally; deploy only after device ear-test (especially step 3).

## ZIP

**N/A** — prompt deliverable is this markdown file only.
