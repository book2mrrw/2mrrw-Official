# Phase 1 — Most Recent Commits and Diffs

## git log --oneline -10
```
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

## git diff HEAD~1..HEAD --stat
```
 src/app/page.js                             |  13 +++-
 src/components/music/AlbumTracklistSheet.js | 115 +++++++++++++++++-----------
 src/context/AudioContext.js                 |  15 ++--
 src/lib/commerce/entitlements.js            |   1 +
 src/lib/music-access.js                     |   1 +
 src/lib/music-playback.js                   |  51 ++++++++----
 6 files changed, 130 insertions(+), 66 deletions(-)

```

## git diff HEAD~1..HEAD -- src/context/AudioContext.js
```
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

## git diff HEAD~1..HEAD -- src/app/page.js
```
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
         return;
       }
       const access = resolveContentAccess(albumItem, accountState);

```

## git diff HEAD~1..HEAD -- src/lib/music-access.js
```
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

## git diff HEAD~1..HEAD -- src/lib/commerce/entitlements.js
```
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

## git diff HEAD~1..HEAD -- src/components/audio/GlobalAudioPlayerBar.js
```

```

## git diff HEAD~1..HEAD -- src/components/preview/ImmersivePreviewModal.js
```

```
