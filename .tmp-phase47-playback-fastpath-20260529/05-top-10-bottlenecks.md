# 05 — Top 10 Bottlenecks (Playback Startup)

Ranked by impact on tap→audible. Evidence tags: **Live** = Phase 4.7 curl; **Code** = static analysis; **Est.** = prior audits.

## 1. Server stream resolution chain (CRITICAL)

**Where:** `src/app/api/library/stream/route.js` → `buildStreamResponse` → `resolvePlaybackKey`, entitlement, session DB  
**Symptom:** Dominates entitled playback; every `redirect=1` byte request pays full server chain.  
**Evidence:** **Live** 279–804 ms TTFB on 401 (auth still runs); Phase 4.5 est. 150–600 ms entitled cold.  
**Mark:** `playback-resolver` (JSON path only); redirect path — no client mark.

## 2. Preview API redirect hop (HIGH for guests)

**Where:** `/api/media/preview?folder=…` → 302 to R2  
**Symptom:** Extra origin RTT before CDN when catalog uses folder-based preview resolution.  
**Evidence:** **Live** 602 ms TTFB (302).  
**Mark:** N/A (preview often bypasses stream marks).

## 3. CDN / first-byte latency (HIGH)

**Where:** R2 public CDN `pub-….r2.dev`  
**Symptom:** Time from `audio.src` assign to `loadeddata`.  
**Evidence:** **Live** 954 ms TTFB for 64 KiB range; 420 ms TTFB full file; cold HEAD 7846 ms outlier.  
**Mark:** `playback-src-to-first-byte`.

## 4. Serial HEAD after JSON stream fetch (MEDIUM–HIGH)

**Where:** `src/lib/playback/stream-client.js` `assertSignedAudioUrl`  
**Symptom:** +1 RTT before src on JSON/refresh path; skipped on `redirect=1`.  
**Evidence:** **Code** + prior **Live** HEAD outliers 711–3893 ms.  
**Mark:** `playback-signed-url`.

## 5. iOS gesture unlock + WebAudio resume (MEDIUM first tap)

**Where:** `AudioContext.js` `unlockAudioFromGesture`, `resumeWebAudioContextIfSuspended`  
**Symptom:** Delays `PLAYBACK_REQUEST` → resolver on cold Safari.  
**Evidence:** **Est.** 5–80 ms mobile (instrumentation doc).  
**Mark:** `playback-request-to-resolver`, `audio-start-latency`.

## 6. Command queue serialization (LOW–MEDIUM under load)

**Where:** `dispatchPlaybackCommand` serial queue  
**Symptom:** Widens `playback-tap-to-request` if prior command in flight.  
**Evidence:** **Code**  
**Mark:** `playback-tap-to-request`.

## 7. Cover preload at play start (LOW–MEDIUM)

**Where:** `preloadCoverImage` in `playTrackInternal`  
**Symptom:** Competes for bandwidth/CPU with audio fetch on constrained mobile.  
**Evidence:** **Code** (parallel, not awaited — contention **Est.**).

## 8. 12s audio ready timeout (TAIL)

**Where:** `waitAudioSrcReady` / `AUDIO_SRC_READY_TIMEOUT_MS`  
**Symptom:** Long wait before error UX on dead URLs.  
**Evidence:** **Code**  
**Mark:** failure before `PLAYBACK_CANPLAY`.

## 9. Redirect path observability blind spot (OBSERVABILITY)

**Where:** `performanceMarks.js` — resolver marks empty on fast path  
**Symptom:** Dev tables under-report server segment for entitled plays.  
**Evidence:** **Code**  
**Mitigation:** Network panel or future `Server-Timing`.

## 10. No production tap→audible telemetry (OBSERVABILITY)

**Where:** `canMark()` NODE_ENV gate  
**Symptom:** Cannot regress prod p95; audits rely on curl + estimates.  
**Evidence:** **Code**  
**Mark:** All stages **Pending** in production.

---

## Top 3 by measured latency (this session)

1. **CDN cold HEAD** — 7846 ms TTFB (outlier; probe artifact)  
2. **CDN first 64 KiB** — 954 ms TTFB after preview path  
3. **`/api/library/stream` (redirect)** — 513–804 ms TTFB on 401 (server/auth path)

For steady-state fan experience (excluding outliers): **stream API** + **preview API** + **CDN first byte** are the three measured segments to attack first.
