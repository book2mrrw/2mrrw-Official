# Cursor Audit — Mobile Audio Silent Regression (Read-only)
Date: 2026-05-28

Primary target: iOS Safari
Secondary target: Android Chrome
Desktop: working (baseline; do not change)

This report follows the included audit prompt: findings include exact file paths and line numbers; no code changes were made.

---

## Section 1 — Most recent commits and diffs

### `git log --oneline -10`
```text
ef5d36d fix(audio): entitlement and stream access fixes per production prompt
4100ee3 docs(checkpoint): frontend-checkpoint-20260527-2351 build frame of mind
43c2fad docs(foundation): add platform build frame of mind for AI sessions
97f2439 fix(audio): features section playback root cause
51af6ff fix(audio): restore Features and album playback via unified track normalization
5b4cdd3 fix(modal): stabilize singles features albums modal lifecycle and account tab
04dc78d fix(audio): correct F2 F4 mobile gesture and resume per prompt
627f3e7 fix(audio): mobile audio per production prompt (F1–F5)
db88530 fix(modal): permanent mobile modal and account tab crash fixes
0b26e4c feat(audio): position memory — resume same song, restart on track switch
```

### `git diff HEAD~1..HEAD --stat`
```text
 src/app/page.js                             |  13 +++-
 src/components/music/AlbumTracklistSheet.js | 115 +++++++++++++++++-----------
 src/context/AudioContext.js                 |  15 ++--
 src/lib/commerce/entitlements.js            |   1 +
 src/lib/music-access.js                     |   1 +
 src/lib/music-playback.js                   |  51 ++++++++----
 6 files changed, 130 insertions(+), 66 deletions(-)
```

### `git diff HEAD~1..HEAD -- src/context/AudioContext.js`
```diff
diff --git a/src/context/AudioContext.js b/src/context/AudioContext.js
index f841ade..a646d2e 100644
--- a/src/context/AudioContext.js
+++ b/src/context/AudioContext.js
@@ -983,10 +983,10 @@ export function AudioProvider({ children }) {
           patchState({ isPlaying: true, error: null, streamRetryable: false, isBuffering: false });
           return;
         } catch (retryErr) {
-          const streamDenied =
-            (retryErr?.status === 401 || retryErr?.status === 403) &&
-            track?.metadata?.access?.canStream;
-          if (streamDenied) {
+          const entitled = Boolean(track?.metadata?.access?.canStream);
+          const canFallbackToPreview =
+            retryErr?.status === 401 || (retryErr?.status === 403 && !entitled);
+          if (canFallbackToPreview) {
             console.warn("[AudioContext] stream retry denied; falling back to preview", {
               slug: track?.slug || slug,
               trackId: track?.id || slug,
@@ -1257,9 +1257,10 @@ export function AudioProvider({ children }) {
     }
 
     const applyStreamResolveError = (err) => {
-      const streamDenied =
-        (err?.status === 401 || err?.status === 403) && nextTrack?.metadata?.access?.canStream;
-      if (streamDenied) {
+      const entitled = Boolean(nextTrack?.metadata?.access?.canStream);
+      const canFallbackToPreview =
+        err?.status === 401 || (err?.status === 403 && !entitled);
+      if (canFallbackToPreview) {
         console.warn("[AudioContext] stream fetch denied; falling back to preview", {
           slug: nextTrack.slug,
           trackId: nextTrack.id,
```

### `git diff HEAD~1..HEAD -- src/app/page.js`
```diff
diff --git a/src/app/page.js b/src/app/page.js
index f73952a..161cfd4 100644
--- a/src/app/page.js
+++ b/src/app/page.js
@@ -1014,8 +1014,17 @@ export default function Page() {
         "album_modal",
         catalogPlaybackLookup
       );
-      if (tracks.length) {
-        void playQueue(tracks, startIndex);
+      const playable = tracks.filter((t) => Boolean(t.src));
+      if (playable.length) {
+        const tapped = tracks[startIndex];
+        let queueIndex = 0;
+        if (tapped?.src) {
+          const found = playable.findIndex(
+            (t) => t.id === tapped.id && t.metadata?.trackIndex === tapped.metadata?.trackIndex
+          );
+          if (found >= 0) queueIndex = found;
+        }
+        void playQueue(playable, queueIndex);
+        return;
+      }
       const access = resolveContentAccess(albumItem, accountState);
```

### `git diff HEAD~1..HEAD -- src/lib/music-access.js`
```diff
diff --git a/src/lib/music-access.js b/src/lib/music-access.js
index 3fb8551..99afa11 100644
--- a/src/lib/music-access.js
+++ b/src/lib/music-access.js
@@ -241,6 +241,7 @@ export function partitionLibraryByType(library = [], catalog = { singles: [], al
     const type = String(item.product_type || "").toLowerCase();
     const isAlbum =
       type === "album" ||
+      type === "ep" ||
       albumSlugs.has(item.slug) ||
       (Array.isArray(item.tracks) && item.tracks.length > 1);
     if (isAlbum) {
```

### `git diff HEAD~1..HEAD -- src/lib/commerce/entitlements.js`
```diff
diff --git a/src/lib/commerce/entitlements.js b/src/lib/commerce/entitlements.js
index 6f6c4de..c3a7b37 100644
--- a/src/lib/commerce/entitlements.js
+++ b/src/lib/commerce/entitlements.js
@@ -248,6 +248,7 @@ export function isDigitalProduct(product) {
     type === "audio" ||
     type === "single" ||
     type === "album" ||
+    type === "ep" ||
     type === "feature"
   );
 }
```

### `git diff HEAD~1..HEAD -- src/components/audio/GlobalAudioPlayerBar.js`
No output (no diff for this file in the last commit range).

### `git diff HEAD~1..HEAD -- src/components/preview/ImmersivePreviewModal.js`
No output (no diff for this file in the last commit range).

---

## Section 2 — Desktop vs mobile divergence (iOS gesture chain, state, handlers, SW, audio element)

### A — Gesture chain

Summary of what iOS Safari is strict about (per prompt):
- `audio.play()` must be called synchronously inside the user gesture handler.
- If `audio.play()` is called after any `await`, inside a `useEffect`, inside `setTimeout`, or inside a Promise callback, it is likely rejected with `NotAllowedError`.

Findings: `AudioContext.js` contains multiple `audio.play()` / `*.play()` calls that are *not* synchronous within a tap handler.

1. `await audio.play()` after an `await` in `loadAudioSrcAndPlay`
   - Call site: `src/context/AudioContext.js:114`
   - Context (10+ lines around call):
```js
async function loadAudioSrcAndPlay(audio, src) {
  await waitAudioSrcReady(audio, src);
  try {
    await audio.play();
  } catch (e) {
    if (e.name !== "AbortError") {
      console.error("[AUDIO]", e.name, e.message);
    }
  }
}
```
   - Classification: Deferred (audio.play is behind `await waitAudioSrcReady(...)`).
   - Regression? Possibly.

2. `await audio.play()` after async checks in `playAudioIfNotPaused`
   - Call site: `src/context/AudioContext.js:126`
   - Context:
```js
async function playAudioIfNotPaused(audio, isPlaying) {
  if (!isPlaying) return;
  if (!audio.paused) return;
  try {
    await audio.play();
  } catch (e) {
    if (e.name !== "AbortError") {
      console.error("[AUDIO]", e.name, e.message);
    }
  }
}
```
   - Classification: Deferred (async function; call occurs after prior async control flow in callers).
   - Regression? Possibly.

3. `audio.play().catch(...)` inside `canplay` event callback
   - Call site: `src/context/AudioContext.js:767`
   - Context:
```js
const resumeAfterInterrupt = () => {
  if (stateRef.current.isPlaying && audio.paused) {
    audio.play().catch(() => {});
  }
  audio.removeEventListener("canplay", resumeAfterInterrupt);
};
audio.addEventListener("canplay", resumeAfterInterrupt);
```
   - Classification: Deferred (executed later by media event; not synchronous to a tap).
   - Regression? No (for initial tap), but relevant for resume behavior.

4. `audio.play().catch(...)` inside `ended`/repeat logic
   - Call site: `src/context/AudioContext.js:881`
   - Context:
```js
const finishEnded = () => {
  if (repeatMode === "one" && stateRef.current.currentTrack) {
    audio.currentTime = 0;
    audio.play().catch(() => {});
    return;
  }
 
  if (queue.length > 0) {
    let nextIndex = queueIndex + 1;
    if (shuffleRef.current && queue.length > 1) {
      let candidate = Math.floor(Math.random() * queue.length);
      while (candidate === queueIndex) {
        candidate = Math.floor(Math.random() * queue.length);
      }
      nextIndex = candidate;
    } else if (nextIndex >= queue.length) {
      if (repeatMode === "all") nextIndex = 0;
      else {
        patchState({ isPlaying: false, currentTime: 0, playbackState: "idle" });
        setPreviewEnded(false);
        if (typeof navigator !== "undefined" && "mediaSession" in navigator) {
          navigator.mediaSession.playbackState = "none";
        }
        if (track) void updateMediaSession(track, { playing: false });
        return;
      }
    }
    const nextTrack = queue[nextIndex];
    if (nextTrack) {
      queueIndexRef.current = nextIndex;
      patchState({ queueIndex: nextIndex, playbackState: "playing" });
      void playTrackRef.current?.(nextTrack, { resumeAt: 0 }).then((ok) => {
        if (ok && csModeRef.current) void applyCSModeToTrackRef.current?.(nextTrack);
      });
      return;
    }
  }

  patchState({ isPlaying: false, currentTime: 0, playbackState: "idle" });
  setPreviewEnded(false);
  if (typeof navigator !== "undefined" && "mediaSession" in navigator) {
    navigator.mediaSession.playbackState = "none";
  }
  if (track) void updateMediaSession(track, { playing: false });
};
```
   - Classification: Deferred (executed on `ended`, not a tap).
   - Regression? No for “initial silent on tap”.

5. `await audio.play()` after `await waitAudioSrcReady(...)` in the stream retry path
   - Call site: `src/context/AudioContext.js:977`
   - Context:
```js
skipPauseInterruptionRef.current = true;
await waitAudioSrcReady(audio, data.url);
if (resumeAt > 0) {
  const seekAfterLoad = () => {
    if (resumeAt > 0 && isFinite(audio.duration)) {
      audio.currentTime = Math.min(resumeAt, Math.max(0, audio.duration - 0.25));
    }
    audio.removeEventListener("loadedmetadata", seekAfterLoad);
  };
  audio.addEventListener("loadedmetadata", seekAfterLoad);
  if (isFinite(audio.duration) && audio.duration > 0) seekAfterLoad();
}
try {
  await audio.play();
} catch (e) {
  if (e.name !== "AbortError") {
    console.error("[AUDIO]", e.name, e.message);
  }
}
patchState({ isPlaying: true, error: null, streamRetryable: false, isBuffering: false });
return;
```
   - Classification: Deferred (behind `await waitAudioSrcReady`).
   - Regression? Possibly (if this is the code path for mobile playback).

6. `await audio.play()` in the `playTrack` flow (isSameTrack block)
   - Call site: `src/context/AudioContext.js:1551`
   - Context:
```js
if (isSameTrack) {
  try {
    await audio.play();
  } catch (e) {
    if (e.name !== "AbortError") {
      console.error("[AUDIO]", e.name, e.message);
    }
  }
}
```
   - Classification: Deferred (behind async control flow inside an async callback; not synchronous in tap handler).
   - Regression? Possibly.

7. `await audio.play()` inside CS mode application
   - Call site: `src/context/AudioContext.js:1798`
   - Context:
```js
if (audio.paused && stateRef.current.isPlaying) {
  try {
    await audio.play();
  } catch (e) {
    if (e.name !== "AbortError") {
      console.error("[AUDIO]", e.name, e.message);
    }
  }
}
```
   - Classification: Deferred.
   - Regression? Maybe, if CS mode is involved on mobile.

8. `await audio.play()` inside resume/init logic (with unlock + resume awaited before play)
   - Call site: `src/context/AudioContext.js:1917`
   - Context:
```js
try {
  await unlockAudioFromGesture(audio);
  initWebAudio();
  await resumeWebAudioContextIfSuspended(audioCtxRef);
  await audio.play();
  if (track) void updateMediaSession(track, { playing: true });
  patchState({ isPlaying: true, error: null, accessDenied: false, playbackState: "playing" });
}
```
   - Classification: Deferred with respect to iOS gesture chain (there are `await`s before `audio.play()`).
   - Regression? Possibly (if triggered by a play action that iOS does not treat as direct gesture).

9. `await audio.play()` in CS hold preview async IIFE
   - Call site: `src/context/AudioContext.js:2251`
   - Context:
```js
if (csHoldSavedRef.current?.wasPlaying) {
  try {
    await audio.play();
  } catch (e) {
    if (e.name !== "AbortError") {
      console.error("[AUDIO]", e.name, e.message);
    }
  }
}
```
   - Classification: Deferred (async IIFE after awaits).
   - Regression? No for initial tap.

10. `await audio.play()` in CS hold end async IIFE
   - Call site: `src/context/AudioContext.js:2301`
   - Context:
```js
if (saved.wasPlaying && audio.paused) {
  try {
    await audio.play();
  } catch (e) {
    if (e.name !== "AbortError") {
      console.error("[AUDIO]", e.name, e.message);
    }
  }
}
```
   - Classification: Deferred (async IIFE after awaits).
   - Regression? No for initial tap.

**Most iOS-relevant pattern (for a silent-on-tap regression):** the core playback `playTrack` implementation calls `await audio.play()` from inside async flows that already have `await` earlier in the same call chain (see Section 2B + Section 3 trace).

### B — AudioContext state (suspended → resume gesture unlock timing)

1. Full `resumeWebAudioContextIfSuspended` function
   - Source: `src/context/AudioContext.js:135-143`
```js
/** Safari keeps AudioContext suspended until resumed inside a user gesture. */
async function resumeWebAudioContextIfSuspended(ctxRef) {
  const ctx = ctxRef?.current;
  if (!ctx || ctx.state !== "suspended") return;
  try {
    await ctx.resume();
  } catch (e) {
    console.warn("[WebAudio] resume failed:", e);
  }
}
```

2. Is the gesture unlock called synchronously at the very start of `playTrack`?
   - `playTrack` starts at `src/context/AudioContext.js:1178`
   - First 40 lines of `playTrack` (prompt request):
```js
const playTrack = useCallback(async (track, options = {}) => {
  const audioEl = audioRef.current;
  if (audioEl?.paused) {
    void unlockAudioFromGesture(audioEl);
  }

  initWebAudio();
  await resumeWebAudioContextIfSuspended(audioCtxRef);
  setPreviewEnded(false);
  if (!track || (typeof track !== "object")) {
    console.error("[AudioContext] playTrack: invalid track", track);
    return false;
  }
  const normalized = normalizeTrack(track);
  if (!normalized.slug && !normalized.id && !normalized.src) {
    console.error("[AudioContext] playTrack: track missing identity and src", track);
    return false;
  }
  const presentation = resolvePlaybackPresentation(normalized, csModeRef.current, csUsingAlternateSrcRef.current);
  let nextTrack = {
    ...normalized,
    title: presentation.title,
    src: presentation.src,
    cover: presentation.cover,
  };
 
  preloadCoverImage(nextTrack.cover || nextTrack.baseCover, {
    coverArtType: nextTrack.coverArtType,
  });
  perfMark(MARKS.AUDIO_START_LATENCY_START);
  logPlayback("play_track", { trackId: nextTrack.id, source: nextTrack.source });
  const audio = audioRef.current;
  if (!audio) {
    console.error("[AudioContext] playTrack: audio element not mounted");
    patchState({
      currentTrackId: nextTrack.id || null,
      currentTrack: nextTrack,
      source: nextTrack.source,
      isPlaying: false,
      error: "Audio player unavailable.",
```
   - Unlock call location: `unlockAudioFromGesture` is invoked via `void unlockAudioFromGesture(audioEl)` at `src/context/AudioContext.js:1181` before the first `await` in `playTrack`.
   - Classification: The unlock invocation is synchronous (function call occurs before `await resumeWebAudioContextIfSuspended(...)`).

3. Is `resumeWebAudioContextIfSuspended()` called before or after the first `await` in `playTrack`?
   - It is the first `await` in the first 40 lines of `playTrack`: `await resumeWebAudioContextIfSuspended(audioCtxRef)` at `src/context/AudioContext.js:1185`.

**Regression? Yes / Possibly:** iOS requires that the eventual `audio.play()` invocation also happen while still in a user-gesture synchronous chain. In this code, `playTrack` is `async` and it performs an `await` (`resumeWebAudioContextIfSuspended`) before reaching `await audio.play()` in later blocks (see Section 3 and the `audio.play()` call site at `src/context/AudioContext.js:1551`).

### C — `visibilitychange` and `pagehide` handlers

1. Full `visibilitychange` handler (`onVisibility`)
   - Full handler bounds: `src/context/AudioContext.js:2117-2172`
```js
const onVisibility = async () => {
  const audio = audioRef.current;
  const track = stateRef.current.currentTrack;

  if (document.visibilityState === "hidden") {
    if (!track || !stateRef.current.hasStarted || !audio) return;
    wasPlayingBeforeHideRef.current = stateRef.current.isPlaying && !audio.paused;
    const position = audio.currentTime || 0;
    const userId = listeningUserIdRef.current;
    if (userId && track.slug) {
      const dur = isFinite(audio.duration) ? audio.duration : 0;
      if (!(dur > 0 && isNearEndRestorePosition(position, dur))) {
        savePlaybackPosition(userId, track.slug, position, dur);
      }
    }
    const meta = streamMetaRef.current;
    const slug = meta?.slug || parseStreamSlugFromSrc(track.src) || track.slug;
    if (slug && meta && streamUrlNeedsRefresh(meta)) {
      void fetchLibraryStream(slug, { force: false })
        .then((data) => {
          streamMetaRef.current = {
            ...meta,
            url: data.url,
            fetchedAt: Date.now(),
            expiresIn: data.expiresIn || 3600,
            streamEventId: data.streamEventId || meta.streamEventId,
            sessionId: data.sessionId || meta.sessionId,
          };
        })
        .catch(() => {});
    }
    return;
  }

  if (document.visibilityState === "visible") {
    const shouldResume = wasPlayingBeforeHideRef.current;
    wasPlayingBeforeHideRef.current = false;

    if (shouldResume && audio) {
      const el = audioRef.current;
      if (el?.paused && stateRef.current.isPlaying) {
        void resumeWebAudioContextIfSuspended(audioCtxRef);
        el.play().catch(() => {});
      }
    }

    if (stateRef.current.currentTrack) {
      void updateMediaSession(stateRef.current.currentTrack, {
        playing: stateRef.current.isPlaying,
      });
    } else {
      rehydrateMediaSession();
    }
    syncPositionState(true);
  }
};
```
   - iOS gesture-chain issue: `el.play().catch(() => {})` occurs inside the `visibilitychange` handler (`src/context/AudioContext.js:2159`).
   - Classification: Likely invalid for iOS gesture requirements (visibility change is not a user gesture).
   - Regression? Possibly (especially if the silent regression happens after background/foreground), but it’s not the primary “tap to start” path.

2. Full `pagehide` handler (`onPageHide`)
   - Full handler bounds: `src/context/AudioContext.js:2197-2210`
```js
const onPageHide = () => {
  const audioEl = audioRef.current;
  if (audioEl && stateRef.current.isPlaying) {
    const t = stateRef.current.currentTrack;
    const userId = listeningUserIdRef.current;
    if (userId && t?.slug) {
      const dur = isFinite(audioEl.duration) ? audioEl.duration : 0;
      const pos = audioEl.currentTime || 0;
      if (!(dur > 0 && isNearEndRestorePosition(pos, dur))) {
        savePlaybackPosition(userId, t.slug, pos, dur);
      }
    }
  }
};
```
   - There is no `audio.play()` inside `onPageHide` (so this handler is unlikely to directly cause silence on tap).
   - Regression? No.

### D — Service worker interference

`public/sw.js` is only 20 lines and contains *no fetch interception*, no caching strategy, and no logic tied to `/api/library/stream` or R2 signed URLs.
Source: `public/sw.js:1-20`
```js
/* 2MRRW background audio keep-alive — minimal SW for Android Chrome session persistence */
const SW_VERSION = "universal-background-audio-20260527";

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || typeof data !== "object") return;
  if (data.type !== "KEEP_ALIVE") return;
  const port = event.ports && event.ports[0];
  if (port) {
    port.postMessage({ type: "KEEP_ALIVE_ACK", version: SW_VERSION, at: Date.now() });
  }
});
```

Questions from prompt (answered from file contents):
- Does it intercept `/api/library/stream` requests? No.
- Does it intercept R2 signed URLs or preview URLs? No.
- Does it cache audio responses for streaming? No.

Regression? No.

### E — CORS and crossOrigin attribute

The `<audio>` element in `AudioContext.js` includes:
- `playsInline`
- `crossOrigin="anonymous"`

Exact element (bounds): `src/context/AudioContext.js:2397-2404`
```jsx
<audio
  ref={audioRef}
  preload="auto"
  playsInline
  crossOrigin="anonymous"
  {...{ "webkit-playsinline": "", "x-webkit-airplay": "allow" }}
  style={{ display: "none" }}
/>
```

Regression? No (these are present).

### F — autoPlay or muted attribute

The `<audio>` element snippet at `src/context/AudioContext.js:2397-2404` includes no `muted` and no `autoPlay` attribute.

Findings from file inspection:
- `muted` attribute: not present on `<audio>` (within the actual `<audio>` element definition).
- `autoPlay` attribute: not present.

Regression? Possibly *indirectly*, but the primary observed failure mode in iOS Safari should be from gesture-chain timing (`audio.play()` after `await`), not missing `muted`, because user-triggered play should not require `muted`.

---

## Section 3 — Full play path trace (tap → playTrack → audio.play)

Note: This is static tracing from code. It does not execute on a device, so it cannot confirm runtime `NotAllowedError` occurrence.

### 3.1 Card play button tap (ReleaseCardPlayButton → playQueue → playTrack)

1. `ReleaseCardPlayButton.js` click handler
   - Handler: `src/components/music/ReleaseCardPlayButton.js:38-66`
   - The play button `onClick={handlePlay}` uses `handlePlay` synchronously.
   - In `handlePlay`, it computes `track = toPlaybackTrack(...)` and then calls:
     - `void playQueue([track], 0);` at `src/components/music/ReleaseCardPlayButton.js:58`

2. `AudioContext.js` `playQueue`
   - `playQueue` implementation: `src/context/AudioContext.js:1895-1899`
```js
const playQueue = useCallback(async (tracks = [], startIndex = 0, options = {}) => {
  const normalized = setQueue(tracks, startIndex);
  if (!normalized.length) return false;
  return playTrack(normalized[Math.max(0, Math.min(startIndex, normalized.length - 1))], options);
}, [setQueue, playTrack]);
```
   - There is no `await` before calling `playTrack(...)`.
   - However, the resulting `playTrack` call is from an async chain.

3. `AudioContext.js` `playTrack` start (first 40 lines)
   - `src/context/AudioContext.js:1178-1217`
   - Key gesture-unlock + first await:
```js
const playTrack = useCallback(async (track, options = {}) => {
  const audioEl = audioRef.current;
  if (audioEl?.paused) {
    void unlockAudioFromGesture(audioEl);
  }

  initWebAudio();
  await resumeWebAudioContextIfSuspended(audioCtxRef);
  setPreviewEnded(false);
  if (!track || (typeof track !== "object")) {
    console.error("[AudioContext] playTrack: invalid track", track);
    return false;
  }
  const normalized = normalizeTrack(track);
  if (!normalized.slug && !normalized.id && !normalized.src) {
    console.error("[AudioContext] playTrack: track missing identity and src", track);
    return false;
  }
  const presentation = resolvePlaybackPresentation(normalized, csModeRef.current, csUsingAlternateSrcRef.current);
  let nextTrack = {
    ...normalized,
    title: presentation.title,
    src: presentation.src,
    cover: presentation.cover,
  };

  preloadCoverImage(nextTrack.cover || nextTrack.baseCover, {
    coverArtType: nextTrack.coverArtType,
  });
  perfMark(MARKS.AUDIO_START_LATENCY_START);
  logPlayback("play_track", { trackId: nextTrack.id, source: nextTrack.source });
  const audio = audioRef.current;
  if (!audio) {
    console.error("[AudioContext] playTrack: audio element not mounted");
    patchState({
      currentTrackId: nextTrack.id || null,
      currentTrack: nextTrack,
      source: nextTrack.source,
      isPlaying: false,
      error: "Audio player unavailable.",
```

4. Where `audio.play()` actually happens later in the `playTrack` flow
   - `await audio.play()` call site in a `playTrack` block:
     - `src/context/AudioContext.js:1551`
```js
if (isSameTrack) {
  try {
    await audio.play();
  } catch (e) {
    if (e.name !== "AbortError") {
      console.error("[AUDIO]", e.name, e.message);
    }
  }
}
```

Gesture-chain break analysis (iOS prompt rules):
- The user gesture calls `playQueue` and (indirectly) `playTrack` without awaiting (`void playQueue(...)`).
- Inside `playTrack`, the code hits `await resumeWebAudioContextIfSuspended(...)` at `src/context/AudioContext.js:1185` before the later `await audio.play()` at `src/context/AudioContext.js:1551`.
- Once control has reached an `await`, the eventual `audio.play()` invocation is very likely outside the original synchronous gesture chain required by iOS Safari (per prompt).

Conclusion for this path: **Likely gesture-chain timing issue** causing `NotAllowedError` / silence on iOS (desktop may be more tolerant).

### 3.2 Cover art tap → modal open → playTrack

1. Cover-art / card tap handler in `page.js`
   - The single card wrapper is clickable:
     - `src/app/page.js:1839-1843` contains `onClick={() => openSingleModal(singleUi)}`

2. `openSingleModal` triggers playback
   - `src/app/page.js:1104-1125`
   - After it computes `playbackTrack`:
     - `if (playbackTrack?.src) void playTrack(playbackTrack);` at `src/app/page.js:1124`
   - No `await` occurs before calling `playTrack(...)` (so `playTrack` is invoked synchronously within the click handler).

3. `playTrack` gesture-unlock + first await (same as above)
   - `src/context/AudioContext.js:1178-1186`
   - Then later `await audio.play()` call sites (e.g. `src/context/AudioContext.js:1551`) occur after an `await`.

Conclusion for this path: **Same iOS gesture-chain risk** applies because `audio.play()` that starts actual playback is not guaranteed to be invoked synchronously before any `await` in `playTrack`.

---

## Section 4 — Console errors specific to mobile

Not executed here (requires running iOS Safari remote debugging / Simulator console logs).

What to look for when verifying on-device:
- `NotAllowedError` messages corresponding to `audio.play()` calls that occur after `await`.
- 401/403 and CORS errors on stream/preview URLs.
- Codec/format errors (`NotSupportedError`).

The code contains multiple `await audio.play()` call sites that occur in async flows (`src/context/AudioContext.js:114, 126, 977, 1551, 1798, 1917, 2251, 2301`), so `NotAllowedError` is the most probable symptom.

---

## Section 5 — 403 fallback change from last fix session

Prompt focus:
- “403 → preview fallback for entitled users” should *not* happen.
- 401 should still fall back to preview.

### 5.1 Stream retry denied fallback logic (401/403)
Block includes the new `entitled` + `canFallbackToPreview` condition:
```js
const entitled = Boolean(track?.metadata?.access?.canStream);
const canFallbackToPreview =
  retryErr?.status === 401 || (retryErr?.status === 403 && !entitled);
if (canFallbackToPreview) {
  console.warn("[AudioContext] stream retry denied; falling back to preview", {
    slug: track?.slug || slug,
    trackId: track?.id || slug,
    status: retryErr?.status,
  });
  const previewFallbackSrc =
    getTrackPreviewSrc(track) ||
    track?.metadata?.previewSrc ||
    track?.previewUrl ||
    null;
  if (previewFallbackSrc) {
    skipPauseInterruptionRef.current = true;
    await loadAudioSrcAndPlay(audio, previewFallbackSrc);
    patchState({
      isPlaying: true,
      error: null,
      source: "preview",
      playbackState: "preview_fallback",
      currentTrack: {
        ...track,
        src: previewFallbackSrc,
        metadata: {
          ...(track.metadata || {}),
          access: {
            ...(track.metadata?.access || {}),
            previewOnly: true,
          },
        },
      },
    });
    return;
  }
}
```
Source: `src/context/AudioContext.js:985-1021` (key condition at `src/context/AudioContext.js:986-988`).

Answer:
- 403 for entitled users (`canStream === true`): `canFallbackToPreview` becomes `false`, so **it will not fall back to preview** in this block.
- 401: `retryErr?.status === 401` makes `canFallbackToPreview` true, so **it should fall back to preview**.

### 5.2 Stream fetch denied fallback logic (401/403)
Full condition inside `applyStreamResolveError`:
```js
const entitled = Boolean(nextTrack?.metadata?.access?.canStream);
const canFallbackToPreview =
  err?.status === 401 || (err?.status === 403 && !entitled);
if (canFallbackToPreview) {
  console.warn("[AudioContext] stream fetch denied; falling back to preview", {
    slug: nextTrack.slug,
    trackId: nextTrack.id,
    status: err?.status,
  });
  const previewFallbackSrc =
    getTrackPreviewSrc(nextTrack) ||
    nextTrack?.metadata?.previewSrc ||
    nextTrack?.previewUrl ||
    null;
  void loadAudioSrcAndPlay(audio, previewFallbackSrc);
  patchState({
    isPlaying: true,
    error: null,
    source: "preview",
    playbackState: "preview_fallback",
    currentTrack: {
      ...nextTrack,
      src: previewFallbackSrc,
      metadata: {
        ...(nextTrack.metadata || {}),
        access: {
          ...(nextTrack.metadata?.access || {}),
          previewOnly: true,
        },
      },
    },
  });
  return;
}
```
Source: `src/context/AudioContext.js:1259-1295` (key condition at `src/context/AudioContext.js:1260-1263`).

Answer:
- 403 for entitled users (`canStream === true`): no preview fallback is taken in this function.
- 401: preview fallback is taken.

Regression risk conclusion:
- This matches the described intent for entitled 403 vs preview fallback.
- So 401/403 fallback regression is less likely than gesture-chain timing as the cause of “silent on iOS”.

---

## Section 6 — Album slug fix impact on singles/features

Prompt focus:
- Check in `music-playback.js` whether the album track slug fix could affect shared playback logic used by singles and features.

### 6.1 `normalizeCatalogItemForPlayback`
Source: `src/lib/music-playback.js:37-50`
```js
export function normalizeCatalogItemForPlayback(item) {
  if (!item) return item;
  const next = withR2CatalogMedia({ ...item });
  const preview = next.preview || next.preview_path || next.previewPath || null;
  if (preview) {
    next.preview = preview;
    next.preview_path = next.preview_path || next.previewPath || preview;
    next.previewPath = next.preview_path;
  }
  if (!next.slug && next.title) {
    next.slug = titleToCatalogSlug(next.title);
  }
  return next;
}
```

No album-specific slug resolution exists here; it only:
- normalizes preview fields
- derives `slug` from `title` if `slug` is missing.

### 6.2 `toPlaybackTrack`
Source: `src/lib/music-playback.js:148-193`
```js
export function toPlaybackTrack(item, accountState, source = "library", overrides = {}) {
  const normalized = normalizeCatalogItemForPlayback(item);
  const access = resolveTrackAccess(normalized, accountState);
  const userId = accountState?.userId || overrides.userId;
  const csAudioRaw = normalized?.csAudio || normalized?.cs_audio || null;
  const csCoverRaw = normalized?.csCover || normalized?.cs_cover || normalized?.csCoverArt || null;
  const motionRaw = normalized?.motion_cover_url || normalized?.motionCoverUrl || normalized?.video || null;
  const coverArtType = normalized?.coverArtType || normalized?.cover_art_type || (motionRaw ? "video" : "image");
  const csCoverType = normalized?.csCoverType || normalized?.cs_cover_type || "image";
  const coverRaw =
    normalized?.cover_art_url || normalized?.coverArtUrl || normalized?.cover || normalized?.coverArt || null;
  const videoRaw = motionRaw;
  const cover =
    coverArtType === "video" && videoRaw
      ? catalogMotionVideoUrl(String(videoRaw).replace(/^\//, ""))
      : coverRaw
        ? catalogCoverUrl(String(coverRaw).replace(/^\//, ""))
        : null;
  const previewPath =
    normalized?.preview || normalized?.preview_path || normalized?.previewPath || null;
  const playbackSrc = resolvePlaybackSrc(normalized, access, { userId });
  const previewSrc = previewPath ? catalogPreviewAudioUrl(previewPath) : null;

  return {
    id: normalized?.slug || normalized?.id,
    slug: normalized?.slug,
    preview: previewPath,
    preview_path: normalized?.preview_path || normalized?.previewPath || previewPath,
    title: normalized?.title || "Untitled",
    artist: normalized?.artist || "2MRRW",
    cover,
    coverArtType,
    src: playbackSrc,
    csAudio: csAudioRaw ? resolveCsMediaUrl(csAudioRaw) : null,
    csCover: csCoverRaw ? catalogCoverUrl(csCoverRaw) : null,
    csCoverType,
    source,
    metadata: {
      access,
      previewSrc,
      price: normalized?.price,
      albumSlug: normalized?.albumSlug || overrides.albumSlug,
      ...overrides,
    },
  };
}
```

Answer about F2 impact on singles/features:
- Singles and features in `ReleaseCardPlayButton.js` call `toPlaybackTrack(item, { ...accountState, userId }, source)` with no `overrides` affecting `albumSlug`.
- The slug changes introduced here are generic (preview + derive slug from title); there is no conditional path that would resolve singles/features slugs differently due to an album-specific slug fix.

So, based on the specific functions requested, **F2 is unlikely to be the direct cause** of the iOS silent-on-tap regression.

---

## Section 7 — Summary: most likely root cause

The most likely root cause is iOS Safari rejecting `audio.play()` calls that occur after an `await` in the `playTrack` async call chain. Specifically, `playTrack` is `async` and immediately awaits `resumeWebAudioContextIfSuspended(...)` at `src/context/AudioContext.js:1185` (after invoking `unlockAudioFromGesture`), but the actual playback start uses later `await audio.play()` call sites such as `src/context/AudioContext.js:1551` (and other `await audio.play()` sites like `src/context/AudioContext.js:977`). This violates the prompt’s iOS gesture-chain rule (“no `audio.play()` after any `await`”), which explains mobile-only silence while desktop appears tolerant.

---

## Section 8 — Confirmed working (not the problem)

These items are **confirmed not to be the regression** based on direct code inspection:

1. Service worker interference is not the cause.
   - `public/sw.js` contains only install/activate/message “KEEP_ALIVE” logic and no fetch interception/caching (see `public/sw.js:1-20`).

2. `<audio>` element CORS + inline playback attributes are present.
   - `playsInline` and `crossOrigin="anonymous"` exist on the `<audio>` element in `AudioContext.js` (`src/context/AudioContext.js:2397-2404`).

