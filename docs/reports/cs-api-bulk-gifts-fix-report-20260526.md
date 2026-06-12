# CS API + Bulk Gifts Fix Report

**Date:** 2026-05-26  
**Scope:** Control System public catalog API, artist-platform catalog mapping, admin bulk gifting

## Summary

### FIX 1 — CS audio in public API

Control System public endpoints now expose Control System–native audio/cover fields (`csAudio`, `csCover`, `csCoverType`, `coverArtType`, `hasCs`) on releases and tracks. The per-slug media route returns a release envelope with `csAudio`, `csCover`, and `hasCs` when a release exists (legacy array-only response preserved when only orphan assets exist).

artist-platform maps snake_case and camelCase CS fields in `mapControlSystemRelease` and `mapTrackToFrontendTrack` so storefront/catalog consumers receive `csAudio`, `csCover`, `csCoverType`, `coverArtType`, and `hasCs`.

Supporting type/build plumbing was added in `mediaObjects.ts` so TypeScript and durable media builders carry CS columns through `TrackMediaObject` / `ReleaseMediaObject`.

### FIX 2 — Bulk gifting bugs

- **Collectors:** Query uses `entitlement_status = active` and `verification_status IN (verified, pending)` instead of deprecated `status` values.
- **Subscribers:** Includes `trialing` memberships alongside `active`.
- **Throughput:** Sequential per-recipient grants replaced with batched `Promise.allSettled` (`BATCH_SIZE = 50`).
- **Rate limit:** In-memory per-admin Map bucket (5 requests / 60s) after auth check; TODO comment if Map unavailable.

No deployment was performed.

## Files changed

### 2MRRW-Control-System (`/Users/recharge/2MRRW-Control-System`)

| File | Change |
|------|--------|
| `src/app/api/public/releases/route.ts` | CS fields on release + each track in public list |
| `src/app/api/releases/[slug]/media/route.ts` | Release envelope + CS fields; fallback to asset array |
| `src/server/media/mediaObjects.ts` | Optional CS fields on media types; populate in builders |

### artist-platform (`/Users/recharge/artist-platform`)

| File | Change |
|------|--------|
| `src/lib/control-system/releases.js` | Map CS audio/cover fields from API |
| `src/app/api/gifts/bulk/route.js` | Schema fixes, batching, trialing, rate limit |

## Build results

| Repo | Command | Result |
|------|---------|--------|
| 2MRRW-Control-System | `npm run build` | **Pass** (Next.js 16.2.6) |
| artist-platform | `npm run build` | **Pass** (Next.js 16.2.4; existing themeColor warnings only) |

## Commits

| Repo | SHA | Message |
|------|-----|---------|
| 2MRRW-Control-System | `27c42df8eb2336cf98a27e8fe5b5983727fbfd3a` | feat(api): expose csAudio, csCover, hasCs on public releases and media routes |
| artist-platform | `4c462c61388469392ac5cf4398f8ff54cc964615` | feat(catalog): map CS audio and cover fields from Control System API |
| artist-platform | `cd1986e4e6f45178e52a8037e59fdd09a6c33cb2` | fix(gifts): bulk collector query schema fix, batch grants, include trialing subscribers |

## Deliverable archive

- Report: `docs/reports/cs-api-bulk-gifts-fix-report-20260526.md`
- Manifest: `docs/reports/cs-api-bulk-gifts-fix-report-20260526-manifest.txt`
- Zip: `~/Downloads/cs-api-bulk-gifts-fix-report-20260526.zip`
