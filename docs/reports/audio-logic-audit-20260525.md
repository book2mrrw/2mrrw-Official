# Audio Logic Audit — 2026-05-25

**Scope:** Read-only audit of `/Users/recharge/artist-platform` playback, entitlements, preview enforcement, AV handoff, and navigation persistence.

**Requirements reference:**
- Access tiers: VISITOR (preview only), PURCHASED / SUBSCRIBER / COLLECTOR = full track everywhere
- Zero-friction: click → `preview.play()` immediately (sync, no await before play); entitlement in background; then src swap to full if owned
- Single global audio engine (`AudioContext`)
- AV section (homepage): pause audio on viewport enter; no auto-resume on exit (document only)

---

## 1. FILE MAP (one line per file + role)

| File | Role |
|------|------|
| `/Users/recharge/artist-platform/src/context/AudioContext.js` | Singleton `<audio>` engine: `playTrack`, queue, signed-stream fetch, CS mode, Media Session, visibility pause |
| `/Users/recharge/artist-platform/src/app/layout.js` | Mounts `AudioProvider` + `GlobalAudioPlayerBar` app-wide |
| `/Users/recharge/artist-platform/src/components/audio/GlobalAudioPlayerBar.js` | Persistent dock/expanded player UI via `useImmersivePlayback` |
| `/Users/recharge/artist-platform/src/lib/player/useImmersivePlayback.js` | Modal/dock adapter: progress + toggle → `useMediaEngine` |
| `/Users/recharge/artist-platform/src/media/useMediaEngine.js` | Maps `AudioContext` → `{ state, play, pause, seek, toggle, setVolume }` |
| `/Users/recharge/artist-platform/src/media/mediaEngineBridge.js` | Imperative bridge registration from `AudioProvider` |
| `/Users/recharge/artist-platform/src/media/MediaEngine.js` | Documentation/comment only; no second playback element |
| `/Users/recharge/artist-platform/src/components/system/AudioPhase10Bridge.js` | Queue preloader + playback recovery event wiring |
| `/Users/recharge/artist-platform/src/media/preloader/useQueuePreloader.js` | Preloads **next** queue tracks (not current on mount) |
| `/Users/recharge/artist-platform/src/media/preloader/MediaPreloader.js` | `<link rel=preload>` for audio URLs; **skips** `/api/library/stream` |
| `/Users/recharge/artist-platform/src/lib/music-access.js` | `resolveTrackAccess`, `resolvePlaybackSrc`, `resolveContentAccess` |
| `/Users/recharge/artist-platform/src/lib/music-playback.js` | `toPlaybackTrack`, `albumTracksForPlayback` → access + src |
| `/Users/recharge/artist-platform/src/lib/commerce/entitlements.js` | Server `userCanStreamProduct`, grants, vault tier |
| `/Users/recharge/artist-platform/src/lib/playback/playback-gate.js` | Catalog full-playback gate vs `ownedSlugs` + subscriber/collector |
| `/Users/recharge/artist-platform/src/lib/playback/stream-client.js` | Client `fetchLibraryStream`, URL refresh, session clear |
| `/Users/recharge/artist-platform/src/lib/playback/stream-pipeline.js` | Stream sessions, R2 signed URL TTL (3600s), concurrent stream |
| `/Users/recharge/artist-platform/src/lib/playback/stream-url-cache.js` | Server-side signed URL cache (~8 min) |
| `/Users/recharge/artist-platform/src/lib/playback/resolve-playback-key.js` | Resolves R2 object key for slug |
| `/Users/recharge/artist-platform/src/lib/storage/r2.js` | `getSignedUrl` / `createR2SignedGetUrl` for R2 GET |
| `/Users/recharge/artist-platform/src/app/api/library/stream/route.js` | Entitlement check → signed URL JSON or redirect |
| `/Users/recharge/artist-platform/src/app/api/media/playback/route.js` | Analytics/progress persistence (not src resolution) |
| `/Users/recharge/artist-platform/src/app/api/account/state/route.js` | Unified account payload: `ownedSlugs`, `permissions`, library |
| `/Users/recharge/artist-platform/src/context/AuthContext.js` | Client cache of account state; `refreshAccountState` |
| `/Users/recharge/artist-platform/src/lib/media-urls.js` | `catalogPreviewAudioUrl` → public R2 previews |
| `/Users/recharge/artist-platform/src/app/page.js` | Homepage: play handlers, modal `useEffect` play, AV pause, ambient `Audio` |
| `/Users/recharge/artist-platform/src/components/music/ReleaseCardPlayButton.js` | Card ▶ → `playQueue` / `toggle` |
| `/Users/recharge/artist-platform/src/components/home/CarouselUI.js` | Opens modal (no direct play on cover click) |
| `/Users/recharge/artist-platform/src/components/preview/ImmersivePreviewModal.js` | Immersive modal shell; shared engine controls |
| `/Users/recharge/artist-platform/src/components/preview/immersive/PreviewPlayerControls.js` | 30s **display** cap + stream hint |
| `/Users/recharge/artist-platform/src/components/preview/immersive/constants.js` | `PREVIEW_DISPLAY_CAP_SEC = 30` |
| `/Users/recharge/artist-platform/src/components/preview/PreviewModalPlayer.js` | Modal bar UI via `useImmersivePlayback` |
| `/Users/recharge/artist-platform/src/lib/control-system/playback.js` | Control-system playback event POST helper |
| `/Users/recharge/artist-platform/src/lib/vault-audio.js` | Separate vault UI SFX (`new Audio`) — not music engine |
| `/Users/recharge/artist-platform/shareable/component-exports/*` | Unused duplicate modal/player patterns (not in app tree) |

---

## 2. FLOW MAP (A–F)

### A. Click-to-play flow

1. **Home card ▶** (`ReleaseCardPlayButton`): click → `toPlaybackTrack(item, accountState)` → `playQueue([track])` → `playTrack` (async function).
2. **Immersive modal**: click cover/carousel → `openSingleModal` → `useEffect` when `previewModalOpen` + slug → `playTrack(toPlaybackTrack(...))` — **playback is not started synchronously on click**.
3. **Features rail**: `playFeature` → `setNowPlaying` → separate `useEffect` → `playTrack`.
4. **`playTrack` internals** (`AudioContext.js`):
   - `normalizeTrack`; optional `preloadCoverImage` (not awaited).
   - If `src` is `/api/library/stream`: **`await resolveLibraryStreamForTrack`** → `fetchLibraryStream` network call → then `audio.src = signedUrl`.
   - Else (preview CDN): set `audio.src` directly (no stream fetch).
   - `audio.load()`; **`await audio.play()`**.
5. **Preload:** Global `<audio preload="metadata">`. `useQueuePreloader` warms **upcoming** queue items only. `MediaPreloader.preloadTrack` skips library-stream URLs. **No preview preload on card mount or hover.**
6. **Visitor vs entitled:** Visitors get CDN preview URL (no stream API). Entitled users pay stream API latency before first `play()`.

### B. Entitlement resolution

- **Client:** `resolveTrackAccess` — full stream if `owned` OR active `subscription` (`permissions.subscriber`) OR per-slug/album `collector` OR `collectorCardOwner` OR admin.
- **Server stream gate:** `userCanStreamProduct` — product owned OR (`membershipHasPremiumAccess` OR collector access) for digital products.
- **Unified full access:** Purchase, subscriber, and collector card owner converge on `canStream` + `/api/library/stream` (same player, not tier-specific engines).
- **Cache layers:** `AuthContext.accountState`; server `stream-url-cache.js` (~8 min); client `streamMetaRef` with refresh 5 min before expiry (`STREAM_REFRESH_BEFORE_EXPIRY_MS`).
- **Background upgrade:** `page.js` re-invokes `playTrack` when `accountState` changes while preview modal is open — can swap preview CDN → signed stream, but still through async `playTrack`.

### C. Preview enforcement (30s)

- **Source selection:** `resolvePlaybackSrc` → `catalogPreviewAudioUrl(previewPath)` for non-entitled users (expects R2 preview assets, often pre-clipped).
- **UI only:** `PREVIEW_DISPLAY_CAP_SEC = 30` in `PreviewPlayerControls` caps scrub display and end label — **not** engine `duration`.
- **No hard stop:** `AudioContext` does not pause/stop at 30s for preview-only tracks. `currentTime >= 30` in `onTime` is for **listening analytics** (`recorded30s`), not preview gating.
- **Seek hole:** Preview-only UI can show 30s cap but `seek()` uses full element duration if file is longer.
- **CTA on end:** Purchase/cart buttons shown when `showPurchase`; **no** dedicated handler on preview `ended` at 30s.

### D. Full track streaming (R2, signed URL, seamless upgrade)

- Entitled tracks: `resolvePlaybackSrc` returns `/api/library/stream?slug=…&redirect=1`.
- Client `isLibraryStreamSrc` is true → **always JSON-fetches** signed URL in `playTrack` (redirect=1 not used as fast-path on element).
- R2 signed GET TTL: `STREAM_SIGNED_URL_TTL_SECONDS = 3600` (`stream-pipeline.js`).
- **Seamless upgrade:** Only when parent re-invokes `playTrack` (e.g. modal `accountState` effect); no in-engine entitlement subscription.
- **Failure modes:** 403 → `accessDenied`; 409 concurrent stream → `streamConflict`; element error → retry with fresh signed URL.

### E. AV section handoff (homepage — read only)

- **Component:** `AudioVisualsSection` in `src/app/page.js` (~225–280).
- **On enter viewport:** `IntersectionObserver` → `triggerFocus()` → `onAudioVisualsFocused()` → `handleAudioVisualsFocused` → **`pause()`** if `isPlaying` (lines 595–597).
- **On exit viewport:** YouTube iframe `postMessage` `pauseVideo` only — **no** `resume()` for global music.
- **Shared state:** Same `AudioContext`; `pause()` preserves `currentTrack` and `currentTime` (not `stop()`).
- **Position:** Preserved on audio element; separate from YouTube iframe state.

### F. Navigation persistence

- **`GlobalAudioPlayerBar`** in root `layout.js` — persists across App Router pages.
- **Homepage modal dismiss:** `closeSingleModal` / `dismissNowPlaying` call **`pause()`**, not `stop()`.
- **Tab ambient loops** (`page.js` 808–817): separate `new Audio()` per tab path — parallel to global music, not the engine.
- **Visibility:** `document.visibilitychange` pauses on hide; may resume on visible if was playing (distinct from AV handoff).

---

## 3. BUG LIST (file + line numbers)

### CRITICAL

| Issue | File:lines |
|-------|------------|
| `await fetchLibraryStream()` / `resolveLibraryStreamForTrack` **before** `audio.play()` for library-stream tracks — breaks sync user-gesture autoplay | `src/context/AudioContext.js` 696–714, 749–794, 874 |
| Modal playback starts in **`useEffect`**, not on click handler — extra turn, weaker gesture coupling | `src/app/page.js` 828–835, 921–924 |
| `redirect=1` on stream URL still triggers JSON fetch path — fast-path unused | `src/lib/music-access.js` 200–201; `src/context/AudioContext.js` 747–752 |

### HIGH

| Issue | File:lines |
|-------|------------|
| No preview URL preload on mount/hover for catalog cards | `src/media/preloader/MediaPreloader.js` 25–27; `src/components/music/ReleaseCardPlayButton.js` (no preload) |
| No client 30s preview hard-stop in engine | `src/context/AudioContext.js` 485–503 (analytics only); missing preview gate |
| Preview scrub display capped at 30s but `seek()` uses full duration | `src/components/preview/immersive/PreviewPlayerControls.js` 22–28, 44–47 |
| No preview-ended subscribe/unlock CTA | `src/components/preview/immersive/ImmersiveModalPanel.js`; `AudioContext.js` `onEnded` 506–565 |
| `await audio.play()` after `load()` on every new track | `src/context/AudioContext.js` 850–874 |
| Concurrent stream 409 blocks until user overrides | `src/context/AudioContext.js` 770–782; `src/app/api/library/stream/route.js` 38–48 |

### MEDIUM

| Issue | File:lines |
|-------|------------|
| No mid-play entitlement src upgrade inside AudioContext | `src/context/AudioContext.js`; upgrade only via `page.js` 828–835 |
| `resume()` may `await fetchLibraryStream` when URL stale | `src/context/AudioContext.js` 1103–1137 |
| Unauthenticated/guest: library stream returns 401 | `src/app/api/library/stream/route.js` 86–88 |
| Client subscription needs `permissions.subscriber` + `subscriptionActive` | `src/lib/music-access.js` 148–151 |
| Tab ambient `new Audio` can overlap global music | `src/app/page.js` 808–817 |

### LOW

| Issue | File:lines |
|-------|------------|
| 30s `timeupdate` milestone is analytics, not preview enforcement | `src/context/AudioContext.js` 490–501 |
| Dead shareable duplicate players | `shareable/component-exports/PreviewModalPlayer.js` |
| CS hold preview swaps main element src | `src/context/AudioContext.js` 1388–1414 |
| Vault SFX uses separate `Audio` instances | `src/lib/vault-audio.js` 79+ |

### Known risk checklist

- [ ] First entitled play blocked by stream API round-trip before `play()`
- [ ] iOS/Safari autoplay if `play()` not in direct click handler
- [ ] Unclipped preview files playable past 30s; seek bypasses UI cap
- [ ] Second tab/device → 409 concurrent stream
- [ ] Signed URL expiry mid-session (partially mitigated on resume/visibility)
- [ ] AV pause with no resume when scrolling away (by design)
- [ ] Auth hydration race: preview src first, stream src after `accountState` loads

---

## 4. MISSING PIECES

1. **Sync play pattern:** Set preview CDN `src` and call `audio.play()` in the same click handler (no preceding `await`).
2. **Background entitlement:** Fetch `/api/account/state` or per-slug stream in parallel; swap `src` to signed URL at current time when entitled.
3. **Preview preload:** Register visible catalog preview URLs on mount or card hover (`<link rel="preload">` or hidden `Audio`).
4. **Client preview gate:** `timeupdate` pause/stop at 30s when `metadata.access.previewOnly`.
5. **Preview-end CTA:** On preview cap or `ended`, surface subscribe/unlock affordance.
6. **Stream fast-path:** Use cached signed URL or `redirect=1` on element without mandatory JSON fetch before first play.
7. **In-engine entitlement listener:** Upgrade src mid-play without remounting modal/parent effect.

---

## 5. RECOMMENDED ARCHITECTURE

Keep a **single `AudioProvider` with one `<audio>`** as the only music engine (`AudioContext.js`), with `useMediaEngine` / `GlobalAudioPlayerBar` as thin subscribers. On every play gesture, **synchronously** assign the preview CDN URL (from catalog hydration) and call **`audio.play()` in the same event**—no `await` before that call. In parallel, resolve entitlement from cached `accountState` or background fetch; when `canStream` is true, fetch or reuse a signed R2 URL and **swap `audio.src` at the current `currentTime`**, using `skipPauseInterruptionRef` to avoid spurious pause UI. **Preload** preview URLs for above-the-fold slugs. Enforce preview with a **30s engine clamp** plus end-of-preview CTA for visitors. For the **AV section**, keep **pause-on-enter** via `handleAudioVisualsFocused` and **no auto-resume on exit** unless product changes. Persist playback via **layout-level `GlobalAudioPlayerBar`**; call `stop()` only on explicit teardown. Leave tab ambient and vault SFX as **separate `Audio` instances**, not merged into the music engine.

---

## Duplicate audio engines (non-playback)

| Instance | Location | Purpose |
|----------|----------|---------|
| Main engine | `AudioContext.js` L1524–1529 | All music playback |
| CS preload | `AudioContext.js` L176–180 | Chopped/slowed asset warm-up |
| Tab ambient | `page.js` L813–814 | Looping tab atmosphere |
| Vault SFX | `vault-audio.js` L79+ | UI sound effects |

**Verdict:** One music engine; auxiliary `new Audio()` for SFX/ambience only.

---

*Generated: 2026-05-25 — read-only codebase audit.*
