# Bottlenecks — playback latency pipeline

Ranked by impact on tap→audible. File paths are exact anchors for remediation (separate from this instrumentation-only pass).

## 1. Server-side stream resolve (HIGH)

**Where:** `src/app/api/library/stream/route.js` → `resolvePlaybackKey()` in `src/lib/playback/resolve-playback-key.js`

**Symptom:** Dominates entitled playback when not cached — 2–4 Supabase queries + R2 discovery.

**Evidence:** Phase 4.5 audit estimates 150–600 ms server; live curl shows 686–1627 ms TTFB on 401 responses (includes auth failure path, still indicates API round-trip cost).

**Instrumentation:** `playback-resolver` measure spans `fetchLibraryStream` until JSON `url` returns.

---

## 2. Serial HEAD after JSON stream fetch (MEDIUM–HIGH)

**Where:** `src/lib/playback/stream-client.js` L205–207 `assertSignedAudioUrl`

**Symptom:** Extra RTT before `audio.src` on JSON path; skipped on `?redirect=1` fast path.

**Evidence:** Live CDN HEAD 711 ms (range) vs 3893 ms cold HEAD outlier on hour-glass MP3.

**Instrumentation:** `playback-signed-url` measure isolates HEAD duration.

---

## 3. Redirect fast-path bypasses client marks (LOW for perf, HIGH for observability)

**Where:** `src/lib/music-access.js` `libraryStreamRedirectSrc`; `AudioContext.js` L1475–1476

**Symptom:** Entitled plays set `audio.src` to `/api/library/stream?redirect=1` — no `fetchLibraryStream` on client, so resolver/signed-url marks are empty in dev tables.

**Mitigation for measurement:** Use Network panel or server-timing headers in a future validation phase (out of scope here).

---

## 4. iOS audio unlock + WebAudio resume (MEDIUM on first tap)

**Where:** `AudioContext.js` L1378–1406 `unlockAudioFromGesture`, `resumeWebAudioContextIfSuspended`

**Symptom:** Adds tens of ms before `PLAYBACK_REQUEST` on cold iOS Safari.

**Instrumentation:** `playback-request-to-resolver` and `audio-start-latency` capture this block.

---

## 5. Command queue serialization (LOW–MEDIUM under load)

**Where:** `dispatchPlaybackCommand` L2445+; `playTrack` marks TAP before queue drain

**Symptom:** `playback-tap-to-request` widens if prior playback commands still running.

---

## 6. 12s source ready timeout (TAIL latency)

**Where:** `AudioContext.js` `AUDIO_SRC_READY_TIMEOUT_MS` / `waitAudioSrcReady`

**Symptom:** User waits up to 12s before error UX on dead URLs.

---

## 7. Dev-only instrumentation gap in production (OBSERVABILITY)

**Where:** `performanceMarks.js` `canMark()` NODE_ENV gate

**Symptom:** No prod tap→audible regression guard; `dumpPlaybackTiming` is dev-only by design for this deliverable.

---

## Content-specific notes

| Format | Bottleneck |
|--------|------------|
| MP3 preview | CDN cache hit → low tap→audible; miss → preview API 302 + download |
| WAV preview | Larger decode; `first-byte-to-canplay` tends higher |
| Full stream | Server resolve + proxy byte pump; redirect path avoids JSON+HEAD |

## Recommended next steps (not implemented)

1. Capture dev marks on localhost for three browser targets × preview + stream.
2. Add optional `Server-Timing` on `library/stream` for resolver vs sign vs proxy (validation phase).
3. Sample 1% `playback-tap-to-audible` in observability (see Phase 4.5 remediation plan P2-2).
