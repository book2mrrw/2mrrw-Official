# Root Cause Hypotheses — Ranked

## Symptom signature

Playback starts → audible for ~1–2s → timeline jumps to end → terminates. Network shows failing `POST /api/playback/events`.

---

## #1 — Deferred resume seek to near-end saved position (HIGH confidence: 0.82)

**Mechanism:** `playTrack` loads audio at 0, then `loadedmetadata` seeks to `resumeAt` from localStorage or `accountState.mediaProgress` when `position_seconds > 5` and track not completed.

**Evidence:**

```1180:1195:src/context/AudioContext.js
    if (!resumeAt && userId && streamSlug) {
      const saved = getSavedPlaybackPosition(userId, streamSlug);
      if (saved?.positionSeconds > 5) {
        resumeAt = saved.positionSeconds;
      }
    }
    if (!resumeAt && accountState?.mediaProgress?.length) {
      const savedProgress = accountState.mediaProgress.find(
        (p) => p.product_slug === nextTrack.slug && !p.completed
      );
      if (savedProgress?.position_seconds > 5) {
        resumeAt = savedProgress.position_seconds;
      }
    }
```

```1283:1287:src/context/AudioContext.js
        const applyPendingSeek = () => {
          if (pendingSeekRef.current && isFinite(audio.duration)) {
            audio.currentTime = Math.min(pendingSeekRef.current, Math.max(0, audio.duration - 1));
          }
```

```690:775:src/context/AudioContext.js
    const onEnded = () => {
      // ...
      setTimeout(finishEnded, 2000);
```

**Why it matches:** Brief play from start until metadata → seek to ~duration → native `ended` → scrubber at end.

**Why playback/events appears:** Unrelated; `persistPlayback("play")` fires on `onPlay` at T+0.

**Verify:** Inspect `media_playback_progress` for slug; localStorage key `listening_history_{userId}`; replay with cleared progress.

---

## #2 — ReleaseCardPlayButton 2s `upgradeToFullStream` src reload (HIGH confidence: 0.78)

**Mechanism:** Entitled card play schedules `upgradeToFullStream()` at exactly 2000ms. With redirect fast-path, `streamMetaRef` is often null, so upgrade always fetches JSON and calls `waitAudioSrcReady` — reloading `audio.src` mid-play.

**Evidence:**

```58:62:src/components/music/ReleaseCardPlayButton.js
      if (track.metadata?.access?.canStream) {
        upgradeTimerRef.current = setTimeout(() => {
          void upgradeToFullStream();
        }, 2000);
      }
```

```1340:1371:src/context/AudioContext.js
  const upgradeToFullStream = useCallback(async () => {
    // early return only if streamMetaRef.url AND not stillOnPreview
    // ...
    await waitAudioSrcReady(audio, resolved.track.src);
    // seek to resumeAt = audio.currentTime (~2s)
```

```59:78:src/context/AudioContext.js
async function waitAudioSrcReady(audio, src) {
  audio.src = src;
  // reload — aborts current playback
```

**Failure sub-modes at reload:**
- Bad/short R2 object → immediate `ended`
- 401 on fetch → ACCESS_DENIED pause (different symptom)
- `onEmptied` zeros timeline briefly then wrong duration

**Why it matches:** ~2s timing is hard-coded. Common path for home card play.

**Verify:** Network `GET /api/library/stream?slug=` (JSON, not redirect) at T+2s; test with timer disabled.

---

## #3 — `/api/playback/events` storefront 404 (CERTAIN for telemetry failure; NOT termination cause) (confidence: 0.95 for non-causality)

**Mechanism:** `buildControlSystemUrl` rewrites browser `/api/*` to same-origin. Storefront has no route → 404 HTML.

**Evidence:**

```39:51:src/lib/control-system/client.js
  const shouldUseSameOrigin = isBrowser && normalizedPath.startsWith("/api/");
  const href = shouldUseSameOrigin ? `${url.pathname}${url.search}` : url.toString();
```

Production probe: storefront POST **404**; CS POST **200**.

```571:576:src/context/AudioContext.js
        sendControlSystemPlaybackEvent(track, eventType, { ... });
        // no await, no branch on result
```

**Conclusion:** Red herring for teardown. Correlated timestamp with `onPlay` only.

**Fix class (out of audit scope):** Proxy route on storefront or disable same-origin rewrite for CS-only paths.

---

## #4 — Preview asset ends early + preview ended handler sets cap display (MEDIUM confidence: 0.45)

**Mechanism:** Short preview file fires native `ended` at 1–2s; handler sets `currentTime = PREVIEW_HARD_CAP_SEC` (30).

**Evidence:** `AudioContext.js:694-697`

**Why partial match:** Terminates quickly but scrubber jumps to 30s cap, not necessarily "full track end" unless UI maps duration differently.

---

## #5 — Client/server entitlement mismatch → 401 → preview fallback mid-stream (MEDIUM confidence: 0.40)

**Mechanism:** Client `canStream: true`, session invalid → stream 401 → preview fallback with `previewOnly: true`.

**Evidence:** `AudioContext.js:1074-1100`, `837-863`

**Why weak for 1–2s:** Fallback continues preview; doesn't jump to full duration end unless combined with #1 or short asset.

---

## #6 — Preview 30s hard cap (LOW confidence: 0.05 for this symptom)

**Evidence:** `AudioContext.js:647-666`

**Why rejected:** Cap triggers at 28–30s, not 1–2s.

---

## Exact termination trigger (code-identifiable)

For **jump to end + terminate**, the identifiable handler is:

**`audio` element `ended` event → `onEnded` (`AudioContext.js:690-775`)**

Most likely preceded by:
- **`applyPendingSeek` / `resumeAt` seek** (`1283-1291`) to `min(savedPosition, duration - 1)`, OR
- **`upgradeToFullStream` / `waitAudioSrcReady` src reload** (`1363`, `1148`) ~2s after card play

For **preview-only early end:**
- Same `onEnded` → preview branch sets `currentTime = 30` (`694-697`)

**Not triggered by:** `/api/playback/events` failure.

---

## Decision tree

```
Play starts
├─ persistPlayback("play") → POST /api/playback/events (404) [telemetry only]
├─ Audio plays from t=0
├─ T+0..2s audible
└─ Then one of:
   ├─ loadedmetadata → pendingSeek to near duration → ended [H1]
   ├─ T+2000ms upgradeToFullStream → src reload → ended/error [H2]
   ├─ preview file ends → onEnded preview branch [H4]
   └─ (NOT) playback/events failure
```

---

## Suggested verification order

1. Reproduce from Release card vs modal vs library (isolates 2s timer)
2. Clear `listening_history_*` localStorage + reset `media_playback_progress` row for slug
3. Watch Network at T+2s for JSON `library/stream` (not redirect)
4. Confirm storefront `/api/playback/events` 404 separately (telemetry fix track)
