# Storefront Audit Implementation — 2026-05-25

**Source audit:** `/Users/recharge/Downloads/storefront-audit-2026-05-25.md`  
**Codebase:** `artist-platform` (HEAD ~9095d56 + working tree)  
**Build:** `npm run build` — **passed** (Next.js 16.2.4)

---

## Audit summary (prioritized)

### P0 — Must fix for playback to work

| ID | Issue | Action |
|----|-------|--------|
| 1A | Pause icon uses OS emoji (`⏸`) — ignores cyan styling | **Implemented** — styled `❙❙` bars |
| 1B | `await` before `audio.play()` breaks gesture chain; modal play in `useEffect` | **Mostly already in tree** — `AudioContext.playTrack` sync-first + background signed URL swap; **completed** modal click-path cleanup in `page.js` |
| 1C | R2 public CDN env on Vercel | **Deferred (manual)** — code fallback exists in `r2-public-cdn.js` |

### P1 — UX / modal wiring

| ID | Issue | Action |
|----|-------|--------|
| 2A | Cover click → modal + auto-play same gesture | **Implemented** — `openSingleModal` fires `playTrack` in handler; removed subscriber-only `useEffect` re-play |
| 2B | All four content types: modal + play on cover | **Partial** — singles + albums; features use `nowPlaying` rail (no immersive modal); EPs share album grid pattern |
| 3A | Card play button active state (border/glow) | **Implemented** in `ReleaseCardPlayButton.js` |

### P2 — Preview enforcement / CTA

| ID | Issue | Action |
|----|-------|--------|
| 1D | Engine-level 30s preview cap | **Already present** — `PREVIEW_HARD_CAP_SEC` in `AudioContext` `timeupdate` / `ended` |
| — | Preview-end subscribe CTA | **Deferred** — `onPreviewEnded` hook exists; modal CTA wiring not in scope |

### P3 — Polish

| ID | Issue | Action |
|----|-------|--------|
| 3B | Modal tabs | No change needed (audit confirms correct) |
| 3C | Title glow CSS | **Verified** — `.hero-title-glow` / `.song-title-turquoise-glow` in `globals.css` |
| 3D | `MusicAccessBadge` tokens | **Minor tweak** — cyan for `canStream` tier |

---

## Implemented in this session

1. **`ReleaseCardPlayButton.js`** — Pause glyph `❙❙`, active-state background/border/glow per audit 3A.
2. **`page.js`**
   - `openSingleModal`: synchronous `playTrack` in click handler; `modalPlaySlugRef` defers play only while `authLoading`.
   - Removed subscriber-only modal `useEffect` that re-triggered `playTrack` / `upgradeToFullStream` (gesture-chain risk).
   - `closeSingleModal`: no longer calls `pause()` — audio continues with global bar after dismiss (audit 2C).
   - `openAlbumModal`: album cover click opens modal **and** calls `playAlbumTracks(album, 0)` in the same handler.
   - Deep-link album path uses `openAlbumModal`.
3. **`MusicAccessBadge.js`** — `canStream` uses cyan accent token.

## Already present before this pass (not re-written)

- **`AudioContext.js`** — Sync preview `src` + `audio.play()` before library stream resolve; background swap to signed URL; 30s `previewOnly` hard cap.
- **`media-urls.js` / `r2-public-cdn.js`** — `NEXT_PUBLIC_R2_PUBLIC_URL` with documented `r2.dev` fallback when env unset.
- **`CarouselUI.js`** — Cover overlay delegates to `onSingleClick` → `openSingleModal` (play in parent).
- **`AudioVisualsSection`** — IntersectionObserver block (~L248–280) untouched.

## Deferred (requires manual / larger scope)

| Item | Reason |
|------|--------|
| Vercel R2 env verification (1C) | Dashboard-only; redeploy required |
| Features → `ImmersivePreviewModal` (2B) | New modal shell + state; features use inline `nowPlaying` |
| EP-specific modal if distinct from albums | Catalog uses shared album modal |
| `PreviewModalPlayer` vs card button shape parity | Audit allows card dark square vs modal filled circle |
| Preview-end subscribe/unlock CTA UI (P2) | Needs product copy + modal surface |
| `closeSingleModal` was pausing — **fixed**; confirm UX with user |

---

## Files changed

| File | Change |
|------|--------|
| `src/components/music/ReleaseCardPlayButton.js` | Icon + active styles |
| `src/app/page.js` | Modal play path, album auto-play, close behavior |
| `src/components/music/MusicAccessBadge.js` | Token color |
| `docs/reports/storefront-audit-implementation-20260525.md` | This report |

**Prior working-tree files (playback/R2 — not edited this pass):**  
`AudioContext.js`, `media-urls.js`, `r2-public-cdn.js`, `r2.js`, `stream/route.js`, `music-access.js`, `stream-client.js`, `CarouselUI.js`, etc.

---

## Build status

```text
npm run build → exit 0 (compiled successfully)
```

---

## Manual QA checklist

1. **Env (P0)** — Vercel → Settings → Environment Variables: confirm `NEXT_PUBLIC_R2_PUBLIC_URL` and four `CLOUDFLARE_R2_*` keys; redeploy. DevTools Network: preview URL should hit `pub-643e4a94e0184b1fabf6522cfbb16f75.r2.dev` (or your configured public URL), not 401/404.
2. **Guest / entry-level** — Click single cover → modal opens, preview plays within ~1s; stops at 30s; global bar visible.
3. **Subscriber / owner** — Same cover click → preview starts immediately, then upgrades to full stream (no tap required). Safari/iOS: verify play starts on first tap.
4. **Card play button** — Play shows `▶`; while playing shows matching cyan `❙❙` with glow border (not emoji).
5. **Album cover** — Click album art → modal + first track (or album stream) starts without separate Play tap.
6. **Close modal** — Dismiss immersive single modal → audio **continues**, bottom `GlobalAudioPlayerBar` stays.
7. **Auth loading edge** — Hard refresh while logged in, immediately open single modal before account state loads → playback should start when `authLoading` clears (deferred ref path).

---

*No git commit per user request (“lets work”, not “commit”).*
