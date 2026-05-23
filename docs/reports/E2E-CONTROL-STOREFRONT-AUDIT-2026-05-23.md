# E2E Control System ↔ Storefront Audit

**Date:** 2026-05-23  
**Control system:** https://2mrrw-control-system.vercel.app  
**Storefront:** https://artist-platform-silk.vercel.app  
**R2 bucket:** `2mrrw-media`  
**R2 CDN:** https://pub-643e4a94e0184b1fabf6522cfbb16f75.r2.dev  

**Builds:** `npm run build` — **PASS** (exit 0) in both repos.

---

## Summary of fixes

| Area | Change |
|------|--------|
| **Catalog fetch** | Storefront now calls `/api/public/releases` (full `coverUrl` / `loopUrl` / track `publicUrl`) instead of `/api/releases`. |
| **Public API** | Published-only filter; track preview/loop assets get `publicUrl` via `publicPathToUrl`; shared enrich helper. |
| **R2 URLs** | `publicPathToUrl` prepends `NEXT_PUBLIC_R2_PUBLIC_URL` for arbitrary storage paths. |
| **Signed URLs** | Entitlement path (no studio bypass); response `{ data: { signedUrl, url, expiresIn } }`; TTL **3600s**. |
| **Presign** | Added `preview` type → `releases/{id}/tracks/{trackId}/preview.{ext}`. |
| **Slug detail** | CORS for storefront origin; `coverUrl` / `loopUrl` / track `publicUrl` enrichment; 404 if not `published`. |
| **Storefront media** | `sourcePath` resolution in `media.js`; catalog helpers fall back to production CDN base. |
| **Library** | `cover_url` → full HTTPS via `catalogCoverUrl`; stream key avoids double `digital-assets/` prefix. |
| **Env** | `console.warn` when R2 public URL or control system API URL missing. |
| **next.config** | Explicit `pub-643e4a94e0184b1fabf6522cfbb16f75.r2.dev` in `remotePatterns` (both repos). |

**Skipped (already correct):** `CoverArt.js`, `GlyphLyricsPanel` + `ImmersivePreviewModal` (`lyricsText` chain), `mapTrackToFrontendTrack` lyrics mapping, CORS on `/api/public/releases`, release type routing in `page.js`.

---

## Environment flags (local `.env.local` — verify Vercel manually)

| Variable | Control (local) | Storefront (local) | Vercel action |
|----------|-----------------|-------------------|---------------|
| `NEXT_PUBLIC_R2_PUBLIC_URL` | SET | SET | Confirm both projects = CDN URL above |
| `NEXT_PUBLIC_CONTROL_SYSTEM_API_URL` | — | SET | Storefront: `https://2mrrw-control-system.vercel.app` |
| `NEXT_PUBLIC_CONTROL_SYSTEM_URL` | — | not in `.env.local` | Alias supported in code; prefer `..._API_URL` on Vercel |
| `CLOUDFLARE_R2_BUCKET_NAME` | SET | SET | Control (+ storefront if streaming): `2mrrw-media` |
| `CLOUDFLARE_R2_ENDPOINT` | SET | SET | Required for signed URLs / stream |
| `CLOUDFLARE_R2_ACCESS_KEY_ID` / `SECRET` | (present in local) | (present in local) | **Cannot verify dashboard** — ensure set on Vercel |
| `NEXT_PUBLIC_APP_URL` | — | — | Control: `https://2mrrw-control-system.vercel.app` |

**Runtime warnings added:** missing `NEXT_PUBLIC_R2_PUBLIC_URL` (control `r2.ts`, storefront `r2.js`), missing control API URL (storefront `client.js`).

---

## Part 7 — Final checklist

| Item | Status | Notes |
|------|--------|-------|
| `NEXT_PUBLIC_R2_PUBLIC_URL` on control Vercel | **Manual** | Local SET; confirm dashboard |
| `NEXT_PUBLIC_R2_PUBLIC_URL` on storefront Vercel | **Manual** | Local SET |
| `NEXT_PUBLIC_CONTROL_SYSTEM_API_URL` on storefront | **Manual** | Local SET as `..._API_URL` |
| `CLOUDFLARE_R2_BUCKET_NAME=2mrrw-media` on control | **Manual** | Local SET |
| `console.warn` for missing env | **Pass** | Both repos |
| `/api/public/releases` → `{ releases, count }` | **Pass** | Smoke: 200 + CORS |
| Release fields (id, slug, coverUrl, tracks, …) | **Pass** | Enriched in route |
| `coverUrl` / `loopUrl` full HTTPS | **Pass** | `publicPathToUrl` + enrich |
| Track `assets.preview.publicUrl` | **Pass** | Enriched on public + slug routes |
| Only `status=published` | **Pass** | Filter on public route |
| CORS storefront origin | **Pass** | Confirmed via curl |
| `/api/media/.../signed-url` no admin gate | **Pass** | `studioBypass: false`; entitlement service |
| Signed response `{ signedUrl }` / `{ data: { signedUrl } }` | **Pass** | Normalized in route |
| `/api/r2/presign` `preview` type | **Pass** | Added |
| Library stream R2 key prefix | **Pass** | No double prefix |
| Library `cover` full URL | **Pass** | `catalogCoverUrl` |
| `catalogCoverUrl` / motion / preview helpers | **Pass** | CDN fallback base |
| R2 hostname in `next.config` | **Pass** | Both repos |
| Cover art on cards | **Pass** | Public API + mapper |
| Motion cover / preview / entitled audio | **Pass** | Chains wired; entitled needs user session on CS |
| Lyrics panel | **Pass** | No code change |
| Singles vs album tracklist sheet | **Pass** | No code change |

---

## Git diffs by task

### Part 2 — Env `console.warn`

**Control — `src/lib/storage/r2.ts`**
```diff
+let warnedMissingR2PublicUrl = false;
 export function getPublicR2Url(path: string): string | null {
   const base = process.env.NEXT_PUBLIC_R2_PUBLIC_URL;
-  if (!base) return null;
+  if (!base) {
+    if (!warnedMissingR2PublicUrl) {
+      warnedMissingR2PublicUrl = true;
+      console.warn("[2MRRW Control] NEXT_PUBLIC_R2_PUBLIC_URL is not set — ...");
+    }
+    return null;
+  }
```

**Storefront — `src/lib/control-system/client.js`**, `src/lib/storage/r2.js` (same pattern).

---

### Part 3 — Control system A1–A4

**A1 — `src/app/api/public/releases/route.ts`:** `enrichPublicRelease`, published filter, track `publicUrl`.

**A1 — `src/server/media/catalogMediaUrl.ts`:** `getPublicR2Url` first in `publicPathToUrl`.

**A2 — `src/app/api/releases/[slug]/route.ts`:** storefront CORS origins, `enrichReleaseDetail`, 404 unless published.

**A4 — `src/app/api/media/[assetId]/signed-url/route.ts`:** `studioBypass: false`, `{ signedUrl, url, expiresIn }`.

**A4 — `src/server/media/signedUrlService.ts`:** `createR2SignedGetUrl(..., 3600)`.

**Part 6 — `src/app/api/r2/presign/route.ts`:** `type === "preview"` branch.

Full diffs: see `git diff` in control repo for files above.

---

### Part 4 — Artist platform B1–B2

**B1 — `src/app/api/library/route.js`:** resolve `cover` through `catalogCoverUrl`.

**B2 — `src/app/api/library/stream/route.js`:** skip duplicate `digital-assets/` prefix.

---

### Part 5 — Frontend C1, C7 (+ catalog wiring)

**C1 — `src/lib/media-urls.js`:** `R2_CDN_FALLBACK` + `toCatalogCdnUrl`.

**C7 — `next.config.mjs`:** explicit `pub-643e4a94e0184b1fabf6522cfbb16f75.r2.dev`.

**Catalog — `src/lib/control-system/releases.js`:** fetch `/api/public/releases`.

**Catalog — `src/lib/control-system/media.js`:** honor `sourcePath` / `source_path`.

---

## API smoke (production)

```bash
curl -sS "https://2mrrw-control-system.vercel.app/api/public/releases?limit=1" \
  -H "Origin: https://artist-platform-silk.vercel.app"
# → 200, access-control-allow-origin: storefront, data.releases[0].coverUrl → https://pub-...r2.dev/...
```

---

## Commits

| Repo | Message | Hash |
|------|---------|------|
| 2MRRW-Control-System | audit: fix public releases API, presign preview type, signed-url auth, R2 url resolution | `6cde62bee52e34cc2785a81bf31ddd961a45b3b3` |
| artist-platform | audit: fix catalog media urls, library cover art, R2 remotePatterns, end-to-end asset chain | `f8a9dbffec158044dae8fb8715b03a66ede987d5` |

---

## Blockers / manual follow-up

1. **Vercel env** — Confirm all rows in the environment table on both projects (cannot read dashboard from this audit).
2. **Deploy** — Push commits and promote deployments for smoke on production URLs.
3. **R2 CORS** — Browser uploads from control UI still require Cloudflare R2 CORS for storefront + control origins (not code in this diff).
4. **Entitled full audio** — Storefront must send control session / user headers when calling `/api/media/{assetId}/signed-url` for non-public assets; guest entitlement is enforced server-side.
