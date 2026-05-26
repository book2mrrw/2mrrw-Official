# UX Audio Flow Audit (Read-Only) — 2026-05-26

**Repository:**   
**Scope:** Read-only code audit of audio UX flows 1–7, A14 (Media Session), and A15 (mobile).  
**Generated:** 2026-05-26

---

## Executive Summary Table

| ID | Item | Status |
|----|------|--------|
| **1** | Seamless modal open (no track restart) | **PARTIAL** — same slug skips reload, but URL mismatch after signed-stream swap can restart |
| **2** | Mini player on modal close | **WORKS** — page mini player reappears paused; GlobalAudioPlayerBar stays visible |
| **3** | Purchase → entitlement upgrade | **PARTIAL** — `refreshAccountState` runs; no auto `upgradeToFullStream` without user action |
| **4** | Preview end, no modal | **MISSING** — silent pause at 30s; no CTA in `GlobalAudioPlayerBar` |
| **5** | Track switch session cleanup | **PARTIAL** — `finalizeStreamSession` on switch; `DELETE /api/library/stream` only on `stop()` |
| **6** | Account state refresh interval | **PARTIAL** — event-driven + post-purchase polling; no global interval in `AuthContext` |
| **7** | Audio during purchase flow | **PARTIAL** — modal cart closes → pause; Stripe overlay does not pause |
| **A14** | Background audio / Media Session | **PARTIAL** — see sub-table below |
| **A15** | Mobile-specific behaviors | **PARTIAL** — see sub-table below |

---

## Flows 1–7

### 1. SEAMLESS MODAL OPEN — `openSingleModal`

**Status: PARTIAL**

`openSingleModal` always calls `playTrack`, but `playTrack` preserves position when same slug **and** same resolved `src` URL.

```1045:1071:/Users/recharge/artist-platform/src/app/page.js
  const openSingleModal = useCallback((single) => {
    if (nowPlaying) setNowPlaying(null);
    if (featureModalOpen) {
      setFeatureModalOpen(false);
      setFeatureModalItem(null);
      setFeatureReleaseDetail(null);
      featureModalPlaySlugRef.current = null;
    }
    setSelectedSingle(single);
    setPreviewModalOpen(true);
    setSelectedReleaseDetail(null);
    if (!single?.slug) return;
    const playbackTrack = toPlaybackTrack(
      single,
      { ...accountState, userId: currentUser?.id },
      "preview_modal"
    );
    if (authLoading) {
      modalPlaySlugRef.current = single.slug;
      return;
    }
    modalPlaySlugRef.current = null;
    if (playbackTrack?.src) void playTrack(playbackTrack);
    void getControlSystemReleaseDetail({ slug: single.slug, fallbackRelease: single }).then((detail) => {
      if (detail) setSelectedReleaseDetail(detail);
    });
  }, [nowPlaying, featureModalOpen, accountState, authLoading, currentUser?.id, playTrack]);
```

Same-track guard in `playTrack`:

```933:988:/Users/recharge/artist-platform/src/context/AudioContext.js
    const currentSrc = audio.currentSrc || audio.src;
    const nextUrl = new URL(syncSrc, window.location.href).href;
    const prevTrack = stateRef.current.currentTrack;
    const sameIdentity =
      (prevTrack?.slug && nextTrack.slug && prevTrack.slug === nextTrack.slug) ||
      stateRef.current.currentTrackId === nextTrack.id;
    const isSameTrack = sameIdentity && currentSrc === nextUrl;
    // ...
      if (!isSameTrack) {
        skipPauseInterruptionRef.current = true;
        audio.pause();
        audio.src = syncSrc;
        audio.load();
        pendingSeekRef.current = resumeAt;
      } else if (resumeAt && Math.abs(audio.currentTime - resumeAt) > 2) {
        audio.currentTime = resumeAt;
      }
```

**Gap:** After background signed-URL swap (`swapToSignedStream`), `audio.currentSrc` is an R2 URL while `toPlaybackTrack` returns `/api/library/stream?slug=…&redirect=1`. `currentSrc === nextUrl` fails → track reloads from start.

Also: `if (nowPlaying) setNowPlaying(null)` always clears the page-level mini player when opening modal.

---

### 2. MINI PLAYER ON MODAL CLOSE — `closeSingleModal`

**Status: WORKS** (paused, visible)

```1128:1134:/Users/recharge/artist-platform/src/app/page.js
  const closeSingleModal = useCallback(() => {
    setPreviewModalOpen(false);
    modalPlaySlugRef.current = null;
    setSelectedSingle(null);
    setSelectedReleaseDetail(null);
    pause();
  }, [pause]);
```

`nowPlaying` restoration after modal closes:

```938:955:/Users/recharge/artist-platform/src/app/page.js
  useEffect(() => {
    if (
      hasStarted &&
      currentTrack &&
      !previewModalOpen &&
      !featureModalOpen
    ) {
      setNowPlaying(currentTrack);
    }
    if (!hasStarted) {
      setNowPlaying(null);
    }
  }, [
    hasStarted,
    currentTrack,
    previewModalOpen,
    featureModalOpen,
  ]);
```

**Behavior:**
- `closeSingleModal` calls `pause()` → `isPlaying` false, `currentTrack` / `hasStarted` remain set.
- Page mini player (`nowPlaying`) **reappears** in **paused** state (desktop lines 2395–2413, mobile 2512–2544).
- `GlobalAudioPlayerBar` (`layout.js` line 42) stays mounted whenever `hasStarted && currentTrack` — independent of modal state.

```452:452:/Users/recharge/artist-platform/src/components/audio/GlobalAudioPlayerBar.js
  if (!hasStarted || !currentTrack) return null;
```

**Note:** On mobile, both page mini player and `GlobalAudioPlayerBar` island/dock can coexist.

---

### 3. PURCHASE → ENTITLEMENT UPGRADE

**Status: PARTIAL**

**Account state refresh after inline checkout:**

```1197:1217:/Users/recharge/artist-platform/src/app/page.js
  const handleCheckoutSuccess = async (paymentIntentId) => {
    if (paymentIntentId) {
      try {
        await fetch("/api/purchase/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ paymentIntentId }),
        });
      } catch { /* webhook may still fulfill */ }
    }
    // ...
    await Promise.all([refreshAccountState(), refreshLibrary()]);
    setMembershipUpsellOpen(true);
```

**Success page polling (webhook lag tolerance):**

```109:135:/Users/recharge/artist-platform/src/app/success/page.js
        await Promise.all([refreshAccountState(), refreshLibrary()]);

        for (let attempt = 0; attempt <= 6; attempt += 1) {
          // ...
          const account = await refreshAccountState();
          await refreshLibrary();
          const owned = new Set(account?.ownedSlugs || []);
          // ...
          if (!pending) break;
          if (attempt < 6) await sleep(2000);
        }
```

**Preview → full stream without reload:** `upgradeToFullStream` exists but is **not** wired to purchase success or `accountState` changes:

```1039:1090:/Users/recharge/artist-platform/src/context/AudioContext.js
  const upgradeToFullStream = useCallback(async () => {
    // ... resolves signed stream, swaps audio.src, clears previewOnly metadata
```

Only automatic caller: `ReleaseCardPlayButton` 2s timer when `track.metadata?.access?.canStream` at play time (lines 54–57). After purchase, user must replay/toggle or wait for that path — no listener on refreshed entitlements.

---

### 4. PREVIEW END STATE — NO MODAL (30s)

**Status: MISSING** (silent pause; no mini-player CTA)

Preview cap in `AudioContext`:

```509:528:/Users/recharge/artist-platform/src/context/AudioContext.js
    const onTime = () => {
      // ...
      const previewOnly = track?.metadata?.access?.previewOnly;

      if (previewOnly && audio.currentTime >= PREVIEW_HARD_CAP_SEC) {
        skipPauseInterruptionRef.current = true;
        audio.pause();
        audio.currentTime = PREVIEW_HARD_CAP_SEC;
        patchState({
          isPlaying: false,
          currentTime: PREVIEW_HARD_CAP_SEC,
          playbackState: "ended_preview",
        });
        setPreviewEnded(true);
        onPreviewEndedRef.current?.(track);
        dispatchPreviewEnded(track.slug);
        return;
      }
```

`GlobalAudioPlayerBar.js` — **no** `previewEnded`, `playbackState`, or `PreviewEndedCTA` usage. Renders until `stop()` or track change. Only access-denied shows a CTA:

```359:368:/Users/recharge/artist-platform/src/components/audio/GlobalAudioPlayerBar.js
  const errorMessage = accessDenied ? (
    <span>
      Access unavailable —{" "}
      <a href={storeLinkHref || "/subscribe"} className="player-immersive-access-link">
        get access
      </a>
    </span>
  ) : (
    error
  );
```

Modal-only CTA: `ImmersivePreviewModal.js` lines 114–150 (`PreviewEndedCTA`). `setOnPreviewEnded` / `preview:ended` event have **no consumers** outside `AudioContext`.

---

### 5. TRACK SWITCH — SESSION CLEANUP

**Status: PARTIAL**

On track switch, `finalizeStreamSession` (POST analytics, clears ref):

```943:955:/Users/recharge/artist-platform/src/context/AudioContext.js
    if (
      previousTrack?.slug &&
      previousTrack.slug !== nextTrack.slug &&
      stateRef.current.hasStarted &&
      !isSameTrack
    ) {
      const prevMeta = streamMetaRef.current;
      if (prevMeta) {
        finalizeStreamSession(prevMeta, {
          completed: false,
          durationSeconds: audio.currentTime || 0,
        });
      }
```

`finalizeStreamSession` → `endStreamAnalytics` POST, **not** DELETE:

```267:276:/Users/recharge/artist-platform/src/context/AudioContext.js
  const finalizeStreamSession = useCallback((meta, { completed = false, durationSeconds = 0 } = {}) => {
    if (!meta?.streamEventId && !meta?.sessionId) return;
    void endStreamAnalytics({
      streamEventId: meta.streamEventId || null,
      sessionId: meta.sessionId || null,
      durationSeconds,
      completed,
    });
    streamMetaRef.current = null;
  }, []);
```

`DELETE /api/library/stream` only on explicit `stop()`:

```1415:1425:/Users/recharge/artist-platform/src/context/AudioContext.js
  const stop = useCallback(() => {
    // ...
    if (meta) {
      finalizeStreamSession(meta, { ... });
      void clearLibraryStreamSession(meta.slug, meta.sessionId);
    }
```

```95:101:/Users/recharge/artist-platform/src/lib/playback/stream-client.js
export async function clearLibraryStreamSession(slug, sessionId) {
  const params = new URLSearchParams({ slug });
  if (sessionId) params.set("sessionId", sessionId);
  await fetch(`${LIBRARY_STREAM_PATH}?${params.toString()}`, {
    method: "DELETE",
```

**Risk:** Server-side concurrent-stream sessions may accumulate on track switch until `stop()` or server TTL.

---

### 6. ACCOUNT STATE REFRESH INTERVAL

**Status: PARTIAL** (no global polling; targeted retries)

**`AuthContext`** — fetch on mount, auth events, manual calls only. **No `setInterval` polling:**

```83:103:/Users/recharge/artist-platform/src/context/AuthContext.js
  const refreshAccountState = useCallback(async () => {
    const res = await fetch("/api/account/state", { credentials: "include", cache: "no-store" });
    // ...
    applyAccountPayload(data);
    return data;
  }, [applyAccountPayload]);
```

```140:191:/Users/recharge/artist-platform/src/context/AuthContext.js
  useEffect(() => {
    // supabase getSession → refreshAccountState OR refreshGuest
    // onAuthStateChange SIGNED_IN → applySessionUser → refreshAccountState
  }, [applySessionUser, refreshAccountState, refreshGuest]);
```

**Post-subscription polling** (`subscribe/page.js`): 2500ms × 5 attempts after `?subscribed=1` (lines 58–66) and after subscription success (lines 127–133).

**Post-purchase polling** (`success/page.js`): up to 7 attempts, 2000ms apart (lines 111–134).

**Webhook path:** Server-side (Stripe → Supabase); client learns via explicit `refreshAccountState()` calls, not push to `AuthContext`.

**Unrelated:** `page.js` line 861 `setInterval(tick, 1000)` is live countdown only.

---

### 7. AUDIO DURING PURCHASE FLOW

**Status: PARTIAL**

**Modal “Add to cart” → closes modal → pauses:**

```117:120:/Users/recharge/artist-platform/src/components/preview/ImmersivePreviewModal.js
  const handleAddToCart = useCallback(() => {
    onAddToCart(single);
    closeModal();
  }, [onAddToCart, single, closeModal]);
```

→ `closeSingleModal` → `pause()`.

**Inline checkout (`handleCheckout`) — no pause:**

```1184:1195:/Users/recharge/artist-platform/src/app/page.js
  const handleCheckout = async () => {
    if (cart.length === 0) return;
    setCheckingOut(true); setCheckoutError("");
    try {
      const res  = await fetch("/api/create-payment-intent", { ... });
      // sets clientSecret — no pause() call
```

**Stripe overlay** (lines 2746–2768): opens over page; **no audio pause** before or during payment element.

**Audio focus handler** only pauses for cinematic visuals focus, not checkout:

```601:604:/Users/recharge/artist-platform/src/app/page.js
  const handleAudioVisualsFocused = useCallback(() => {
    if (isPlaying) pause();
  }, [isPlaying, pause]);
```

---

## A14 — Background Audio & Media Session

**Primary file:** `/Users/recharge/artist-platform/src/context/AudioContext.js`  
**Layout:** `/Users/recharge/artist-platform/src/app/layout.js` — wraps `AudioProvider` + `GlobalAudioPlayerBar`; **no** `mediaSession` code.

| Sub-item | Status | Location |
|----------|--------|----------|
| `navigator.mediaSession` references | **IMPLEMENTED** | Lines 330, 343, 354–355, 500–501, 1441–1443, 1448–1449 |
| Metadata (title, artist, album, artwork) | **IMPLEMENTED** | `updateMediaSession` 353–378; artwork via `getArtworkEntriesForTrack` |
| Action handlers: play, pause, previoustrack, nexttrack, seekto | **IMPLEMENTED** | 1447–1487 |
| `playsinline` / `webkit-playsinline` on audio | **PARTIAL** | `<audio playsInline>` line 1753; no `webkit-playsinline` attribute on audio element |
| Web Audio API `AudioContext` + resume on gesture | **MISSING** in AudioContext | Only in `/Users/recharge/artist-platform/src/lib/vault-audio.js` 47–62 |
| `visibilitychange` / `document.hidden` | **IMPLEMENTED** | 1490–1570 — pauses on hide, resumes on visible |
| `pagehide` handlers | **MISSING** | No matches in `src/` |
| `beforeunload` handlers | **IMPLEMENTED** | 1585–1598 — persists media session track to sessionStorage |

**Metadata snippet:**

```353:377:/Users/recharge/artist-platform/src/context/AudioContext.js
  const updateMediaSession = useCallback(async (track, { playing } = {}) => {
    if (typeof navigator === "undefined" || !navigator.mediaSession) return;
    const ms = navigator.mediaSession;
    // ...
      ms.metadata = new MediaMetadata({
        title: track.title || "Untitled",
        artist: track.artist || "2MRRW",
        album: track.source || "2MRRW",
        artwork,
      });
      ms.playbackState = playing ? "playing" : "paused";
```

**Action handlers:**

```1467:1472:/Users/recharge/artist-platform/src/context/AudioContext.js
      ms.setActionHandler("play", handlePlay);
      ms.setActionHandler("pause", handlePause);
      ms.setActionHandler("previoustrack", handlePrev);
      ms.setActionHandler("nexttrack", handleNext);
      ms.setActionHandler("seekto", handleSeek);
```

**Audio element:**

```1750:1755:/Users/recharge/artist-platform/src/context/AudioContext.js
      <audio
        ref={audioRef}
        preload="metadata"
        playsInline
        style={{ display: "none" }}
      />
```

---

## A15 — Mobile-Specific Behaviors

| # | Item | Status | Evidence |
|---|------|--------|----------|
| **1** | `PreviewPlayerControls` scrub touch vs mouse | **PARTIAL** | Single `onClick={seekTo}` on progress rail (lines 125–128); no `onTouchStart`/`onTouchMove`; click works on touch but no touch-specific scrub |
| **2** | `touch-action: manipulation` on play button | **PARTIAL** | `globals.css` 1194 (panel scroll), 3245 (gift); `GlobalAudioPlayerBar` inline 346 on cover; **not** on `.player-signature-ring` or modal play ring |
| **3** | Pause event user vs system | **IMPLEMENTED** | `userPausedRef` set in `pause()` 1302; read in `onPause` 483–506 |
| **4** | `mediadevices` / `devicechange` / headphone | **MISSING** | No matches in `src/` |
| **5** | stalled/suspend/waiting/error + retry | **PARTIAL** | `waiting`/`stalled` → `isBuffering` 456–457; `error` → one retry + `retryStreamPlayback` 620–684, 1117–1124; **no `suspend` listener** |
| **6** | Debounce/disabled on play buttons | **MISSING** | `ReleaseCardPlayButton` — no disabled/debounce; `PreviewPlayerControls` — no debounce on `togglePlay` |
| **7** | GPU: will-change, transform vs top/left | **PARTIAL** | `globals.css` uses `will-change: transform, opacity` (932, 955, 970, etc.); `ImmersiveModalScene` orbs use `top`/`left` positioning (456–485) with `transform` in keyframes |
| **8** | Tap targets 44×44 | **PARTIAL** | `ReleaseCardPlayButton` **44×44** inline (92–93); `PreviewPlayerControls` play **52/60px** (96); `ModalActionButtons` mobile: **padding 6px + 34px icon** ≈ 46px (`globals.css` 768–772, `ModalActionButtons.js` 72–78) — not explicit 44×44 min |
| **9** | iPhone SE 375px in `globals.css` | **MISSING** | No `@media (max-width: 375px)` or `375` in `globals.css`; `GlobalAudioPlayerBar` uses `< 360` for `isSmallScreen` (line 123) |
| **10** | `visibilitychange` handlers in `src/` | **IMPLEMENTED** (3 sites) | See below |

**A15.3 — user vs system pause:**

```483:506:/Users/recharge/artist-platform/src/context/AudioContext.js
    const onPause = () => {
      const userInitiated = userPausedRef.current;
      userPausedRef.current = false;
      if (skipPauseInterruptionRef.current) {
        skipPauseInterruptionRef.current = false;
        return;
      }
      // ...
      if (!userInitiated && track && audio.paused) {
        /* External audio interruption — metadata retained, state paused */
      }
    };
```

**A15.10 — all `visibilitychange` handlers:**

| File | Lines | Purpose |
|------|-------|---------|
| `/Users/recharge/artist-platform/src/app/page.js` | 767–779 | Pause singles carousel `<video>` when hidden |
| `/Users/recharge/artist-platform/src/context/AudioContext.js` | 1490–1603 | Pause/resume main audio; refresh signed URL on return |
| `/Users/recharge/artist-platform/src/hooks/sync/useSyncEngine.js` | 94–101 | Resync catalog when tab visible (250ms debounce) |

---

## Audited File Manifest (for zip)

```
/Users/recharge/artist-platform/src/app/page.js
/Users/recharge/artist-platform/src/app/layout.js
/Users/recharge/artist-platform/src/app/globals.css
/Users/recharge/artist-platform/src/app/success/page.js
/Users/recharge/artist-platform/src/app/subscribe/page.js
/Users/recharge/artist-platform/src/context/AudioContext.js
/Users/recharge/artist-platform/src/context/AuthContext.js
/Users/recharge/artist-platform/src/components/audio/GlobalAudioPlayerBar.js
/Users/recharge/artist-platform/src/components/preview/ImmersivePreviewModal.js
/Users/recharge/artist-platform/src/components/preview/PreviewEndedCTA.js
/Users/recharge/artist-platform/src/components/preview/immersive/PreviewPlayerControls.js
/Users/recharge/artist-platform/src/components/preview/immersive/ModalActionButtons.js
/Users/recharge/artist-platform/src/components/preview/immersive/ImmersiveModalScene.js
/Users/recharge/artist-platform/src/components/music/ReleaseCardPlayButton.js
/Users/recharge/artist-platform/src/lib/playback/stream-client.js
/Users/recharge/artist-platform/src/lib/music-playback.js
/Users/recharge/artist-platform/src/lib/music-access.js
/Users/recharge/artist-platform/src/lib/media-session-artwork.js
/Users/recharge/artist-platform/src/hooks/sync/useSyncEngine.js
```

---
