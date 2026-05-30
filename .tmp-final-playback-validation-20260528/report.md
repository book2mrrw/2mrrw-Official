# Final E2E Playback Validation — 2026-05-28

Read-only validation + live probes. No UI or AudioContext orchestration changes.

**Bucket:** `2mrrw-media` | **Public CDN:** `https://pub-643e4a94e0184b1fabf6522cfbb16f75.r2.dev`  
**Production:** `https://www.2mrrw.com` | **Local (branch):** `http://127.0.0.1:3099`

## Summary counts

| Metric | Pass | Fail | Notes |
|--------|------|------|-------|
| **Entities (12) — end-to-end playback viable** | **5** | **7** | Full stream or working public preview |
| R2 direct-child audio (requested entities) | 5 | 7 | Flat folder discovery (`Delimiter: /`) |
| Public CDN Range 0–1023 (preview/master) | 5 | 2 | Legacy feature `.wav` previews 404 |
| Local `/api/media/preview` (302) | 4 singles + legacy keys | folder + mixtape previews | See §5 |
| Local `/api/media/visual` meta=1 | 4 singles + features* + mixtapes* | idbu/2-heavy with wrong `releaseType` | *use `feature`/`ep` not `features` |
| Production `/api/media/*` | 0 | all probed | **Vercel HTML 404** — routes not on prod |
| Production `/api/library/stream` | N/A | 401 w/o session | **Expected** — route exists |
| Playback code audit | PASS | — | No `audio.wav` hardcode; trackSlug wired |

---

## Entity matrix

| Entity | R2 audio | R2 preview folder | Preview (local API) | Visual (local API) | Stream route | Blockers |
|--------|----------|-------------------|---------------------|-------------------|--------------|----------|
| **hour-glass** | ✅ `audio.mp3` | ✅ | ✅ 302 → CDN | ✅ video | 401¹ | Prod media API not deployed |
| **w2d** | ✅ | ✅ | ✅ 302 | ✅ video | 401¹ | Same |
| **turnt-me-2-dis** | ✅ | ✅ | ✅ 302 | ✅ video | 401¹ | Same |
| **artificial** | ✅ | ✅ | ✅ 302 | ✅ video | 401¹ | Same |
| **i-dont-believe-you** | ❌ features/ + singles/ empty | ❌ | legacy 302² | ❌³ / ✅⁴ | 401¹ | No master; legacy preview 404 CDN; upload/migrate |
| **2-heavy** | ❌ | ❌ | legacy 302² | ❌³ | 401¹ | Same |
| **love-hz-vol-1 / 01-roll-call** | ❌ empty folder | ❌ | 404 | ✅ image⁵ | 401¹ | Missing track upload |
| **love-hz-vol-1 / 09-hour-glass** | ❌ | ❌ | 404 | ✅ image⁵ | 401¹ | Missing track upload |
| **ad / 01-2mrrws-ntro** | ✅ `2mrrw's Ntro.wav` | ❌ | 404 | ✅ image⁵ | 401¹ | No preview clip; entitled-only |
| **tbh / 01-glass-full** | ❌ empty folder | ❌ | 404 | ✅ image⁵ | 401¹ | Missing track upload |

¹ `GET /api/library/stream?slug=…&redirect=1` → **401** without fan/guest cookie (correct). Entitled path: `resolvePlaybackKey` + signed R2.  
² Legacy `?legacy=previews/…-preview.wav` redirects locally but **CDN GET/Range → 404**.  
³ `releaseType=features` (plural) — resolver falls back to `single` → wrong paths.  
⁴ `releaseType=feature` → image fallback works.  
⁵ `releaseType=ep` or `mixtape` — album artwork image.

---

## 1. Player mount / queue / timeline (code + R2)

**Play path (catalog modals / home):**

`page.js` `playCanonicalCatalogItem` → `normalizeTrackForPlayback` → `playTrack` (`AudioContext.js`) → `unlockAudioFromGesture` + `resumeWebAudioContextIfSuspended` at start → `resolvePlaybackSrc` / library stream redirect → `audio.src` → `loadedmetadata` / `durationchange` → `patchState({ duration, hasStarted })` → `GlobalAudioPlayerBar` scrub via `engineDuration ?? duration`.

**R2 alignment:** Singles use flat folders (`digital-assets/singles/{slug}/audio.mp3`). Mixtape tracks use `digital-assets/mixtapes-and-eps/{album}/{trackSlug}/<file>`. Missing R2 objects → `playTrack: no playback src` for guests without preview.

**Queue:** `playQueue` / album modal sets queue; `hasStarted` gates dock visibility and scrub.

---

## 2. Duration resolution dependency

Duration comes from the single `<audio>` element (`crossOrigin="anonymous"`): `AudioContext` listeners `durationchange` / `loadedmetadata` set `state.duration`. Timeline (`GlobalAudioPlayerBar` → `PlayerBarScrub`) uses `engineDuration ?? duration`. **No R2 metadata required** for scrub; WAV/MP3 must load enough for `audio.duration` to become finite.

---

## 3. Signed vs public URL results

| Layer | Singles (4) | Features (2) | Mixtape samples |
|-------|-------------|--------------|-----------------|
| **Public CDN** (preview/master) | 206 Range OK | legacy preview **404** | master: ad intro **206**; others N/A |
| **`/api/library/stream`** prod | 401 (no cookie) | 401 | 401 |
| **Signed path (code)** | `resolvePlaybackKey` → `createR2SignedGetUrl` when entitled | Blocked at R2 (no key) | `trackSlug` passed in route + `libraryStreamRedirectSrc` |

Client: entitled → `libraryStreamRedirectSrc(slug, { trackSlug })` (`redirect=1` fast path). Guest/preview-only → `catalogPreviewAudioUrl(previewPath)` (direct CDN, not stream API).

---

## 4. Video artwork + image fallback probes

| Entity | R2 video | Local visual (`meta=1`) | CDN video Range |
|--------|----------|---------------------------|-----------------|
| hour-glass | ✅ mp4 | video | 206 |
| w2d, turnt-me-2-dis, artificial | ✅ | video | (not all probed; same pattern) |
| i-dont-believe-you | ❌ | image with `releaseType=feature` | — |
| love-hz-vol-1, ad, tbh (release) | ❌ at release | image (`ep`/`mixtape`) | — |

`resolveVisualMedia`: video first, then artwork folder (`entity-resolver.js`).

---

## 5. Preview fallback probes

| Probe | Result |
|-------|--------|
| `folder=previews/singles/hour-glass/` (local) | **302** → `hourglass-preview.mp3` |
| `folder=previews/features/i-dont-believe-you/` | **404** (no folder objects) |
| `legacy=previews/i-dont-believe-you-preview.wav` (local) | **302** → CDN path |
| Same legacy on CDN | **404** |
| Mixtape track preview folders | **404** (no previews in R2 for sampled tracks) |

Production `https://www.2mrrw.com/api/media/preview?...` → **HTML 404** (`x-matched-path: /404`) — route not deployed; `/api/account/state` returns 200.

---

## 6. Exact failing layer per broken entity

| Entity | Failing layer |
|--------|----------------|
| **i-dont-believe-you** | R2: no audio in `features/` or `singles/`; CDN: legacy preview 404; entitled stream would 404 at `resolvePlaybackKey` |
| **2-heavy** | Same |
| **love-hz-vol-1 / 01-roll-call** | R2: empty `digital-assets/mixtapes-and-eps/love-hz-vol-1/01-roll-call/` |
| **love-hz-vol-1 / 09-hour-glass** | R2: empty track folder |
| **tbh / 01-glass-full** | R2: empty track folder |
| **All entities (prod preview/visual)** | Deploy: `/api/media/preview` + `/api/media/visual` missing on production |
| **Features visual (caller bug)** | API param `releaseType=features` → wrong folder; use `feature` |

**Not broken (with auth + deploy):** four singles; **ad intro** master only (no preview).

---

## 7. Minimal remediation

1. **Deploy** current branch to production so `/api/media/preview` and `/api/media/visual` replace site 404.
2. **Upload flat masters** for features → `digital-assets/singles/{slug}/` or `features/{slug}/` + update `products.storage_path`; migrate legacy previews to `previews/features/{slug}/*.mp3` (remove flat `.wav` or make public).
3. **Upload mixtape track files** for `01-roll-call`, `09-hour-glass`, `tbh/01-glass-full` under `digital-assets/mixtapes-and-eps/.../{track}/`.
4. **Optional previews** for mixtape tracks + ad intro (guest playback).
5. **Catalog/API:** accept `releaseType` aliases (`features` → `feature`, `singles` → `single`) in visual route if UI sends plurals.
6. **Env:** keep `NEXT_PUBLIC_R2_PUBLIC_URL` on public `pub-643e4a94…` CDN (not `pub-992d4f5d`).

---

## Playback chain (code audit) — PASS

| Check | Status | Location |
|-------|--------|----------|
| No `audio.wav` in playback `src/` | ✅ | Only migration script references |
| `trackSlug` on stream route | ✅ | `stream/route.js` GET param → `resolvePlaybackKey` |
| `features/` → `singles/` fallback | ✅ | `resolve-playback-key.js` L121–125 |
| `crossOrigin="anonymous"` | ✅ | `AudioContext.js` audio element |
| Gesture unlock at `playTrack` | ✅ | `unlockAudioFromGesture` before load |
| `hasStarted` + timeline | ✅ | `AudioContext` + `GlobalAudioPlayerBar` |

---

## Mobile (code-level)

- `crossOrigin="anonymous"` on sole `<audio>` — Safari/CORS-safe analyser path.
- `unlockAudioFromGesture` + `resumeWebAudioContextIfSuspended` at `playTrackInternal` entry.
- **Device QA still required** (lock screen, background, Bluetooth).

---

## R2 script snapshot

```
probed: 39 | withAudio: 17 | withPreview: 4 | withArtwork: 9 | withVideo: 4
singlesFallbackHits: []
```

Other mixtape tracks **with** audio (not in user sample list): e.g. `love-hz-vol-1/03-guarded-heart` … `10-turnt-me-2-dis`, most `ad/*` except noted gaps.

See `r2-verify.json` and `curl-results.txt`.
