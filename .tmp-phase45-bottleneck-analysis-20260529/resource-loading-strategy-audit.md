# Resource Loading Strategy Audit

**Audit date:** 2026-05-29  
**Mode:** Read-only  
**Question:** Is each resource type loaded just-in-time (JIT) or too early?

---

## Summary matrix

| Resource type | Current strategy | Verdict | Primary evidence |
|---------------|------------------|---------|------------------|
| Hero MP4 | `preload="auto"` on first paint | **Too early** | `page.js` L1783 |
| Singles carousel MP4 | `preload="metadata"`, play in-viewport | **Mostly JIT** | `LatestSinglesStyleRow.js` L110; sync L631–641 |
| Cover images (home) | Pipeline preload 18 items on home tab | **Too early** (partial) | `page.js` L822–834 |
| Catalog metadata | `/api/catalog/releases` on mount, `no-store` | **Necessary early** | L698–706 |
| Exclusive drops | Mount, all tabs | **Too early** | L864–880 |
| Printful shop | Mount, all tabs | **Too early** | L899–901 |
| Vault public | Tab-gated `innercircle` | **JIT ✓** | L882–897 |
| Audio stream (play) | Redirect `?redirect=1` direct to audio | **JIT ✓** (entitled) | `music-access.js`, `AudioContext` L1458+ |
| Signed URL JSON | On visibility refresh / non-redirect | **JIT** (correct path) | `stream-client.js` L120–207 |
| Stream HEAD probe | After JSON fetch | **Redundant** on same-origin proxy | L202 |
| Modal / preview assets | On modal open | **JIT ✓** | ImmersivePreviewModal pattern |
| Stripe.js | Module load on page chunk | **Too early** | `page.js` L5–6, L69 |
| Auth account state | Session bootstrap | **Necessary early** | `AuthContext.js` L220–276 |
| CS mode assets | On track play `preloadCsAssets` | **JIT ✓** | `AudioContext.js` L366–390 |
| Next track cover | `preloadCoverImage` before play | **Appropriate eager** | L1412–1414 |
| Admin panel code | Static import | **Too early** (bytes) | `page.js` L17 |
| Donate modal | `dynamic(..., { ssr: false })` | **JIT ✓** | L8 |

---

## 1. MP4 / motion video

### Hero (`videos/A2B.mp4`)

- **Loader:** `catalogMotionVideoUrl()` → R2 public CDN.
- **Attributes:** `autoPlay muted loop playsInline preload="auto"` (`page.js` L1783).
- **Timing:** Starts buffering as soon as home hero mounts — **before** catalog fetch completes.
- **Competition:** Same window as 2.8 MB JS + `/api/catalog/releases` + account state.
- **Recommendation:** `metadata` or `none` + poster; consider `fetchpriority` lowering vs LCP text.
- **JIT target:** First frame when hero enters viewport (already full viewport — defer buffer start until after `catalogLoading === false` if acceptable UX).

### Singles carousel

- **Loader:** Per-item `item.video` in `LatestSinglesStyleRow.js` L103–110.
- **Attributes:** `preload="metadata"`, `poster={item.cover}`.
- **Playback control:** `syncSinglesCarouselVideos` — play only fully in viewport (`page.js` L631–641); pause on `document.hidden` L848–851.
- **Verdict:** **Good JIT playback**; **DOM eager** — all cards mount `<video>` elements (metadata still fetched per card).
- **Duplicate load:** Poster image + video moov — expected double fetch.

### Ambient playback background

- **Loader:** `currentTrack.cover` / `csCover` as video or CSS background.
- **Timing:** Only when track playing + component mounted.
- **Verdict:** **JIT for playback**; **heavy when active** (blur filter).

### Collector / cinematic (`data-cinematic-video`)

- Tab/modal gated — **JIT relative to Cards tab** (per `08-mp4-loop-audit.md`).

---

## 2. Artwork / images

### Image pipeline (`src/media/imagePipeline/`)

- Priority queue, link preload hints, `decoding="async"`.
- Skips video URLs for image preload (correct).

### Home tab eager batch (`page.js` L822–834)

```javascript
// When activeTab === "home":
displaySingles.slice(0, 8)
features.slice(0, 4)
albums.slice(0, 6)
enrichedRadioSlides.slice(0, 4)
→ imagePipeline.preload(src, "high", ...)
```

- **Max ~22 cover URLs** at high priority after catalog state populated.
- **Verdict:** **Too early** relative to viewport — many below fold on mobile.
- **Better JIT:** IntersectionObserver per row (pattern exists for singles video, not covers).

### CoverArt component

- Preload on mount L29–33 (`CoverArt.js` per prior audit).
- Video-type covers: raw `<video>` without lazy src — loads when card visible in DOM.

### MediaSession artwork

- Async `getArtworkEntriesForTrack` on play — **JIT ✓**.

---

## 3. Audio

### Stream URL (entitled)

- **Primary:** `libraryStreamRedirectSrc` → `audio.src = /api/library/stream?slug=&redirect=1`.
- **Server:** Auth → entitlement → `resolvePlaybackKey` → sign → `proxySignedR2Get` (`api/library/stream/route.js`).
- **Client round trips:** **1** (redirect path) — **optimal**.

### Stream URL (JSON + HEAD)

- `fetchLibraryStream` → JSON → `assertSignedAudioUrl` HEAD (`stream-client.js` L202).
- **Used:** Visibility refresh, legacy paths — **3 RTTs**.
- **Verdict:** HEAD is **too early/ redundant** if proxy already validated.

### Preview audio

- Direct CDN via `catalogPreviewAudioUrl` — **JIT on tap** ✓.

### Preload next cover / CS assets

- `preloadCoverImage` + `preloadCsAssets` at play time — **appropriate eager** for tap→audible UX.

### Single `<audio>` element

- `preload="auto"` on provider element — idle buffer policy; low impact until src set.

---

## 4. Metadata / API

| Endpoint | When | Cache | JIT? |
|----------|------|-------|------|
| `/api/catalog/releases` | Mount | `no-store` | Early **required** for singles grid |
| `/api/catalog/exclusive-drops` | Mount `[]` | `no-store` | **Too early** |
| `/api/printful/products` | Mount | default | **Too early** |
| `/api/public/vault` | `innercircle` tab | `no-store` | **JIT ✓** |
| `/api/account/state` | After session | `no-store` | **Required early** for entitlements |
| `/api/library` | `refreshLibrary` only | — | JIT on action (often duplicated with account state) |

**Catalog `no-store`:** Correct for freshness; prevents HTTP cache wins on repeat visits — product tradeoff, not a loading-order bug.

---

## 5. Signed URLs

- **Server cache:** `getOrCreateStreamSignedUrl` (`stream-url-cache.js`).
- **Resolver cache:** 60s in `entity-resolver.js` (server).
- **Client refresh:** `STREAM_REFRESH_BEFORE_EXPIRY_MS` 5 min before expiry (`stream-client.js` L4).
- **Visibility:** AudioContext L2620+ may refetch — **JIT on background return** ✓.

---

## 6. Modal resources

| Modal | Load trigger | Strategy |
|-------|--------------|----------|
| DonateModal | dynamic import | **JIT ✓** |
| ImmersivePreviewModal | Static import in page | **Bytes eager**, **media JIT** on open |
| AlbumModal | Same module |同上 |
| GiftBottomSheet | Static | Bytes eager |
| CollectorCardAdminPanel | Static L17 | **Bytes too early** for fans |
| VaultUnlockedRoom | Static | Bytes eager; content JIT on vault access |

**Preview stream:** Resolved at open via `resolvePlaybackSrc` — correct.

---

## 7. Route resources

| Route | Loading |
|-------|---------|
| `/` | Full `page.js` shell + all providers |
| `/subscribe`, `/login` | Own client pages but **same layout providers** |
| `/album/[slug]`, `/song/[slug]` | Dynamic server routes — **not** in initial home bundle, but layout stack still paid |

**No route-based code splitting** for storefront tabs — all tab UI in initial page chunk.

---

## Duplicate / unnecessary loading patterns

1. **Poster + video** on every singles card.
2. **refreshAccountState + refreshLibrary** — overlapping library data.
3. **Hero MP4 + 18 cover preloads + catalog API** — triple parallel startup burst.
4. **Cover via img + imagePipeline + MediaSession** — same asset, multiple consumers (play-time).
5. **framer-motion + Stripe** in page chunk — loaded for users who only browse/play.

---

## JIT vs too-early — recommended target state (planning only)

| Resource | Target |
|----------|--------|
| Hero MP4 | Buffer after first paint or metadata-only until idle |
| Shop Printful | Fetch on `activeTab === "shop"` |
| Exclusive drops | Fetch when exclusives UI shown |
| Cover preloads | IntersectionObserver per horizontal row |
| Stripe | dynamic import when cart/checkout opens |
| Admin panel | dynamic import when `isAdmin` |
| Stream HEAD | Remove on same-origin proxy path |
| Audio progress | Ref-based, not context broadcast |

---

## Evidence index

- `src/app/page.js` — L69, L698–706, L822–834, L864–901, L1783, L631–641
- `src/components/home/LatestSinglesStyleRow.js` — L103–110
- `src/components/home/AmbientPlaybackBackground.js` — L41–49
- `src/context/AudioContext.js` — L366–390, L1412–1414, L1458+
- `src/lib/playback/stream-client.js` — L25–47, L120–207
- `src/context/AuthContext.js` — L118, L135–140, L220–276
- `src/app/layout.js` — provider stack
- Build: 2.8 MB client chunks
