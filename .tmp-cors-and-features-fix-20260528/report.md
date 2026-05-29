# CORS + features audio fix — 2026-05-28

## Prompt requirements summary

| # | Requirement | Status |
|---|-------------|--------|
| 1 | R2 CORS policy JSON for manual dashboard paste | **Delivered** — `r2-cors-policy.json` |
| 2 | Fix `/api/library/stream` 404 for `i-dont-believe-you` (features, no track nesting) | **Code fix** — canonical storage + preview folder fallback in `resolve-playback-key.js` |
| 3 | Flat preview path → entity folder `previews/features/{slug}/` | **Code fix** — `catalogPreviewAudioUrl` + `resolveEntityPreviewFolder` |
| — | No UI redesign, AudioContext rewrite, or auth OTP changes | **Honored** |
| — | Preserve entity-folder paths, site-api-url, entitlement audio, features resolver, PREVIEW_ROOT=previews | **Honored** |
| — | `npm run build` passes | **Verified** |
| — | Report zip | `.tmp-cors-and-features-fix-20260528/` → `/Users/recharge/Downloads/cors-and-features-fix-20260528.zip` |

---

## Fix 1 — R2 CORS (manual dashboard)

Browser hits signed URLs on `*.r2.cloudflarestorage.com` directly. Bucket **`2mrrw-media`** must allow storefront origins.

**Paste into Cloudflare → R2 → 2mrrw-media → Settings → CORS:**

See `r2-cors-policy.json` (identical to `docs/reports/r2-cors-policy-recommended.json`).

Dashboard steps: `dashboard-steps.md`  
Verification: `./verification-curls.sh`

### API route CORS (code — deploy with commit)

Added `src/lib/server/media-cors.js` and wired `/api/media/{preview,visual,playback}` with OPTIONS + `Access-Control-Allow-Origin` for the same origin allowlist. `/api/library/stream` stays same-origin only (no CORS headers needed).

---

## Fix 2 — Features stream 404 (`i-dont-believe-you`)

**Root cause:** Features have no track-level nesting. When `products.storage_path` was missing, stale, or pointed at a release with zero `tracks` rows, `resolvePlaybackKey` returned null → stream route 404.

**Fix (`resolve-playback-key.js`):**

- Fall back to canonical catalog `storage_path` and `resolveStoragePath(releaseType, slug)` when DB path is absent
- Retry audio discovery with canonical folder if DB folder misses
- Preview fallback uses `inferProductReleaseType` (features, not singles) + entity preview folder
- Preserved features→singles R2 fallback for legacy bucket layout

**Expected R2 master path:** `digital-assets/features/i-dont-believe-you/{audio file}`

---

## Fix 3 — Flat preview path → entity folder

**Root cause:** Storefront still passes legacy flat paths (`/audio/previews/i-dont-believe-you-preview.wav`). When canonical merge was skipped or DB had flat `preview_path`, resolver tried flat R2 key `previews/i-dont-believe-you-preview.wav` → 404.

**Fix:**

- `resolveEntityPreviewFolder()` in `canonical-catalog.js` — maps flat keys to `previews/features/{slug}/`
- `catalogPreviewAudioUrl()` — handles `audio/previews/`, flat `previews/{slug}-preview.{ext}`, and bare filenames
- Stream preview fallback uses same entity-folder normalization

**Correct client URL:**

```
/api/media/preview?folder=previews/features/i-dont-believe-you/
```

---

## Canonical features slugs

| slug | title |
|------|-------|
| `i-dont-believe-you` | I Don't Believe You |
| `2-heavy` | 2 Heavy |

---

## Files changed

| File | Change |
|------|--------|
| `src/lib/server/media-cors.js` | **New** — shared CORS helper for `/api/media/*` |
| `src/app/api/media/preview/route.js` | OPTIONS + `applyMediaCors` |
| `src/app/api/media/visual/route.js` | OPTIONS + `applyMediaCors` |
| `src/app/api/media/playback/route.js` | OPTIONS + `applyMediaCors` |
| `src/lib/media/canonical-paths.js` | `extractSlugFromFlatPreviewKey`, `isEntityPreviewFolderPath` |
| `src/lib/media/canonical-catalog.js` | `resolveEntityPreviewFolder`; metadata enrichments |
| `src/lib/media-urls.js` | Feature flat preview → entity folder discovery URL |
| `src/lib/playback/resolve-playback-key.js` | Canonical storage/preview fallback for features |
| `docs/reports/r2-cors-policy-recommended.json` | Aligned with prompt policy |

---

## Verification

- [x] `npm run build` — success
- [ ] Manual: paste R2 CORS policy in Cloudflare dashboard
- [ ] Manual: guest feature preview → `/api/media/preview?folder=previews/features/i-dont-believe-you/` → 302 WAV
- [ ] Manual: entitled user → `/api/library/stream?slug=i-dont-believe-you&redirect=1` → 302 signed R2 GET (no CORS 403)

---

## Prior fixes preserved

- Entity-folder paths (`ca6c565`, `7a805b1`)
- site-api-url (`b72a707`)
- Entitlement audio / session alignment (`a6929c0`)
- Features release-type inference in stream resolver (`66e7174`)
- `PREVIEW_ROOT = "previews"`
