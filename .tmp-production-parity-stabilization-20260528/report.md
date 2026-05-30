# Production Parity Stabilization — 2026-05-28

## 1. Production parity (primary blocker)

### Root cause
**Deploy gap, not broken route code.** `src/app/api/media/preview/route.js` and `src/app/api/media/visual/route.js` were **untracked** (`git status: ??`) — they build locally but were never committed, so Vercel production serves Next.js HTML 404 (`x-matched-path: /404`) while `/api/account/state` returns 200.

### Code verification
| Check | Result |
|-------|--------|
| App Router `GET` + `export const dynamic = 'force-dynamic'` | Present on both routes |
| `next.config.mjs` rewrites blocking `/api/media/*` | None (only `2mrrw.com` → `www` redirect) |
| `middleware.js` blocking `/api/media/*` | No — matcher runs `updateSession` but does not block API |
| `npm run build` route table | `ƒ /api/media/preview`, `ƒ /api/media/visual` listed |
| `.next/server/app/api/media/*` | `preview/route.js`, `visual/route.js` present |

### Deploy checklist (required for prod fix)
1. **Stage and commit** untracked media routes + this stabilization batch:
   - `src/app/api/media/preview/route.js`
   - `src/app/api/media/visual/route.js`
   - All files in `manifest.txt`
2. Push to the branch Vercel deploys (e.g. `frontend-stable-foundation` or production branch).
3. Confirm Vercel build log lists `/api/media/preview` and `/api/media/visual`.
4. Post-deploy smoke:
   ```bash
   curl -sI "https://www.2mrrw.com/api/media/preview?folder=previews/singles/hour-glass/"
   curl -s "https://www.2mrrw.com/api/media/visual?releaseType=features&slug=hour-glass&meta=1"
   ```
   Expect **302** (preview) and **JSON** with `type`/`url` (visual), not HTML 404.
5. Ensure R2 env vars on Vercel match local (`.env.local`): `CLOUDFLARE_R2_*`, `NEXT_PUBLIC_R2_PUBLIC_URL`.

---

## 2. Release type normalization

**New:** `src/lib/media/normalize-release-type.js`

- Maps: `single|singles` → `singles`, `feature|features` → `features`, `album|albums` → `albums`, `ep|mixtape|mixtapes-and-eps` → `mixtapes-and-eps`
- `RELEASE_TYPES` exported for validation

**Wired into:**
- `canonical-paths.js` — all path builders use `normalizeReleaseType` / `releaseFolder()`
- `entity-resolver.js` — `resolveVisualMedia`
- `media-availability.js` — `inferReleaseType`
- `resolve-playback-key.js` — preview folder fallback
- `music-playback.js` — via availability cache path
- `catalogMedia.js` — placeholder release type
- `/api/media/visual/route.js` — fixes `releaseType=features` (was rejected before normalization)

Single alias map — no duplicate maps elsewhere.

---

## 3. Lightweight availability awareness

**Extended** `media-availability.js`:

| API | Purpose |
|-----|---------|
| `getCachedAvailability(slug, trackSlug, albumSlug)` | Sync read, 5 min TTL, no R2 |
| `prefetchMediaAvailability(params)` | Deduped async discovery; writes cache |
| `clearMediaAvailabilityCache()` | Wired into `clearMediaResolverCaches()` |

`getPlayButtonState` reads cache when present (`unavailable` / `coming_soon`) before URL heuristics.

**No storefront polling** — cache fills only when callers invoke `prefetchMediaAvailability` (e.g. on play attempt or optional debounced card mount). Catalog render paths unchanged.

---

## 4. Nested track folder resolution

**`resolveStoragePath`** now supports `albumSlug` and treats `albums` like `mixtapes-and-eps`:

- Mixtape/EP track: `digital-assets/mixtapes-and-eps/{projectSlug}/{trackSlug}/`
- Album track: `digital-assets/albums/{albumSlug}/{trackSlug}/`
- Previews/images/videos: `nestedCollectionFolder` aligned (direct child scan via `listR2Objects({ recursive: false })`)

**Verified:**
- `resolve-playback-key.js` passes `trackSlug` to `resolvePlaybackKey(admin, slug, { trackSlug })`
- `GET /api/library/stream?slug=&trackSlug=` accepts `trackSlug` (existing)

---

## 5. Fallback hierarchy (no regression)

| Layer | Order |
|-------|--------|
| Audio (stream) | master (`resolveAudio`) → preview folder (`resolvePreview`) → `MEDIA_UNAVAILABLE` |
| Visual | video entity → artwork entity → placeholder (`resolveVisualMedia` + visual route) |
| Preview API | canonical folder → legacy flat key → 404 JSON |

**Hardcoded playback filenames:** None in `src/lib/playback/*` or `AudioContext` resolution path. Legacy keys remain only in `canonical-catalog.js` as `preview_legacy` fallbacks (by design).

Incomplete-media tolerance preserved: visual route still redirects to placeholder when discovery misses (b5c628b0 behavior).

---

## 6. Admin diagnostics

**New:** `src/lib/media/admin-media-diagnostics.js` — `buildReleaseDiagnostics(release)` → `{ missingAudio, missingPreview, missingArtwork, missingVideo, invalidReleaseType, brokenPlayback, availability }`

**New:** `GET /api/admin/media-diagnostics?slug=` — `getFanSessionUser` + `isAdminUser` gate (same pattern as account state admin flag). Not exposed on storefront.

---

## 7. Mobile audit (code only — no changes)

| Item | Status |
|------|--------|
| Gesture unlock (`unlockFromGesture`, `unlockAudioFromGesture`) | Unchanged in `AudioContext.js` |
| `crossOrigin="anonymous"` on sole `<audio>` | Unchanged (line ~2966) |
| No second `<audio>` element | Confirmed |

---

## 8. Build & validation

| Step | Result |
|------|--------|
| `npm run build` | **Pass** (Next.js 16.2.4) — includes `/api/media/preview`, `/api/media/visual`, `/api/admin/media-diagnostics` |
| Local curl after `next start` | Not completed in CI sandbox (server `uv_interface_addresses` error); build output confirms routes |
| `node scripts/verify-r2-entity-folders.mjs` | **Ran** — 39 entities; 17 audio present; features + many mixtape tracks missing audio in R2 (data gap, not routing) |

---

## 9. Files changed

See `manifest.txt`. Summary:

- **New:** `normalize-release-type.js`, `admin-media-diagnostics.js`, `api/admin/media-diagnostics/route.js`
- **Modified:** canonical-paths, entity-resolver, media-availability, cache-invalidation, resolve-playback-key, music-playback, catalogMedia, visual route
- **Untracked (must commit for prod):** `api/media/preview/route.js`, `api/media/visual/route.js`

---

## 10. Verdict

| Question | Answer |
|----------|--------|
| Routes broken in code? | **No** — correct exports, build artifacts present |
| Production 404 cause? | **Deploy** — media API routes never committed/deployed |
| `releaseType=features` bug? | **Fixed** — normalization in visual route + path builders |
| Commit required? | **Yes** for production fix (media routes + stabilization files) |

---

*Generated: 2026-05-29*
