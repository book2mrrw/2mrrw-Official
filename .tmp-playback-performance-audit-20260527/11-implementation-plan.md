# 11. Permanent implementation plan (no code in this audit)

**Principles:** mobile-first, no UI redesign, no dependency bumps, entitlements unchanged, one `<audio>` element.

---

## P0 — Highest impact / lowest risk

### P0.1 Transcode feature previews on R2

| Files | Change |
|-------|--------|
| R2 objects `previews/*-preview.wav` | Replace with ~128kbps MP3, 30s max, target &lt;400KB |
| `src/lib/commerce/catalog.js` | Update `preview_path` extensions |
| Migration/seed | Sync `products` table paths |

**Impact:** −3–8s poor-network time-to-play for features. **Effort:** ops + catalog rows.

### P0.2 Assign `audio.src` synchronously on tap

| Files | Change |
|-------|--------|
| `ReleaseCardPlayButton.js`, `page.js` handlers | Call thin `primeAudioSrc(url)` on pointerdown before React dispatch |
| `AudioContext.js` | Export ref-safe primer; skip duplicate load in `playTrack` if same src |

**Impact:** −100–400ms perceived latency. **Effort:** small.

### P0.3 Remove or gate cross-track fade on mobile

| Files | Change |
|-------|--------|
| `AudioContext.js` 1471–1492 | Skip fade when `matchMedia('(max-width: 768px)')` or reduced motion |

**Impact:** −0–300ms on track change. **Effort:** trivial.

---

## P1 — Stream path hardening

### P1.1 Seed `streamMetaRef` on redirect play

| Files | Change |
|-------|--------|
| `AudioContext.js` `playTrack` | After setting redirect src, fire-and-forget `fetchLibraryStream` to populate meta (no src swap) |
| `stream-client.js` | Optional: `HEAD` or `?format=json` only if needed |

**Impact:** Fewer mid-session stalls; better visibility refresh. **Effort:** medium.

### P1.2 Canonical stream host (no 307 www)

| Files | Change |
|-------|--------|
| Vercel/domains config | Apex vs www consistency |
| `libraryStreamRedirectSrc` | Use `window.location.origin` or env canonical |

**Impact:** −1 RTT (~50–150ms). **Effort:** infra.

### P1.3 `waitAudioSrcReady` tuning

| Files | Change |
|-------|--------|
| `AudioContext.js` | Prefer `loadeddata` for early play; reduce timeout 3s→1.5s with retry; log slow starts |

**Impact:** −0–1500ms worst case. **Effort:** small + QA on Safari.

---

## P2 — Preload & caching

### P2.1 Smarter `preload` attribute

| Files | Change |
|-------|--------|
| `AudioContext.js` `<audio>` | Default `metadata`; set `auto` only while `isPlaying` |

**Impact:** Lower idle cellular use. **Effort:** small.

### P2.2 Credential-aware stream hint

| Files | Change |
|-------|--------|
| `MediaPreloader.js` | For entitled slugs, `<link rel=prefetch>` same-origin stream redirect (not fetch preload) |
| `preloadBudget.js` | Separate budget bucket |

**Impact:** −200–500ms entitled first play when visible. **Effort:** medium.

### P2.3 CDN `Cache-Control` for public previews

| Files | Change |
|-------|--------|
| R2/Cloudflare rules | `public, max-age=86400, immutable` on `previews/*` |

**Impact:** Repeat play −80% TTFB. **Effort:** ops.

### P2.4 Don't cancel audio hints in `preloadCoverImage`

| Files | Change |
|-------|--------|
| `src/lib/media/preload.js` | Remove or narrow `cancelHints()` |

**Impact:** Card preloads survive cover play. **Effort:** trivial.

---

## P3 — React / telemetry

### P3.1 Split context / memo bar

| Files | Change |
|-------|--------|
| `AudioContext.js`, `GlobalAudioPlayerBar.js` | `useAudioPlayback()` vs `useAudioUiState()` |

**Impact:** Smoother scrubbing, less main-thread React work. **Effort:** medium.

### P3.2 Defer Media Session artwork

| Files | Change |
|-------|--------|
| `media-session-artwork.js`, `updateMediaSession` | Set text metadata immediately; artwork async |

**Impact:** −50–200ms contention on play event. **Effort:** small.

---

## P4 — Observability

| Files | Change |
|-------|--------|
| `performanceMarks.js` | Production sample 1% `audio-start-latency` to observability |
| `stream-client.js` | Mark stream 401/403 latency |

---

## Explicit non-goals

- Second audio element
- Client-side entitlement overrides
- Full offline blob pipeline for streaming
- framer-motion / page.js layout changes
- Dependency version bumps

---

## Suggested implementation order

1. P0.1 feature preview transcode  
2. P0.2 sync src prime  
3. P0.3 mobile fade skip  
4. P1.2 canonical host  
5. P1.1 streamMeta seed  
6. P1.3 waitAudio tuning  
7. P2.x preload/cache  
8. P3.x React/telemetry  

## QA gates

- `npm run test:foundation`
- iOS Safari: single, feature, album queue, background 10min
- Subscriber stream + airplane toggle
- Guest preview 30s cap
- No regression: one audio element, lock screen metadata
