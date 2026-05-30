# Full Media + Playback Integrity Audit

**Date:** 2026-05-29  
**Output:** `.tmp-full-media-playback-integrity-audit-20260528/`  
**Prior:** `.tmp-r2-cors-media-validation-20260528/report.md`  
**Mode:** Validation only — no playback orchestration changes.

---

## 1. Full media inventory

Six streamable audio products (4 singles MP3, 2 features WAV), six matching public previews, three albums (track titles only in UI), plus merch/vault. Canonical masters: `digital-assets/singles/{slug}/audio.{mp3,wav}`. Details: `01-media-inventory.md`.

## 2. Missing / incomplete media

| Gap | Severity |
|-----|----------|
| Feature full masters `i-dont-believe-you`, `2-heavy` — **404 on public CDN** | **High** if objects absent in private bucket (entitled stream fails) |
| Album per-track masters | **High** without Control System `media_assets` backfill |
| `digital-assets/albums/`, `mixtapes-and-eps/` | Unreferenced / unverified in repo |
| Capital `Singles/`, `Features/` keys | Not used — 404 if relied on |

All previews probed **200**. All four single MP3 masters **200/206** on public CDN.

## 3. Stale DB / media mappings

- `storage_path` prefix inconsistency (singles short path vs features full path) — normalized in code.
- Feature backfill migration `20260528071100_backfill_feature_storage_paths.sql` — required for DB parity.
- Album inline tracks ≠ product slugs — stream slug collapse to album level.
- See `stale-path-inventory.txt`, `03-database-paths.md`.

## 4. Failed R2 validations

| Probe | Result |
|-------|--------|
| `digital-assets/singles/i-dont-believe-you/audio.wav` | 404 |
| `digital-assets/singles/2-heavy/audio.wav` | 404 |
| `digital-assets/features/...` | 404 |
| `digital-assets/Singles/...` | 404 |
| Legacy CDN host | 401 |

Passes: all previews, all single MP3 masters, CORS + Range on hour-glass. Raw: `curl-probes.txt`, `02-r2-object-validation.md`.

## 5. Playback init failures (code-level)

Documented guards in `AudioContext.playTrackInternal` and `stream-client.assertSignedAudioUrl`. Primary runtime failures: empty `src`, unmounted audio, stream 401/403/404, `SIGNED_STREAM_*` after HEAD on presigned URL. Detail: `05-playback-init.md`.

## 6. Entitlement failures

Server `userCanStreamProduct` vs client `resolveTrackAccess` — guest 401, non-subscriber preview-only, stale `accountState` causing UI/server mismatch. Detail: `06-entitlements.md`.

## 7. UI playback failures (code-level)

Album missing preview paths; feature entitled play depends on stream key existence; queue/Media Session circuit on repeated errors. Unified via `catalogPlaybackLookup` / `toPlaybackTrack`. Detail: `07-ui-queue.md`.

## 8. Exact remaining blockers

1. **Feature WAV masters not on public CDN (404)** — confirm objects exist at signed keys in `2mrrw-media`; if missing, entitled feature playback fails regardless of CORS.
2. **Album full playback** — requires DB `content_id` + `media_assets` paths; inline catalog alone insufficient.
3. **Signed-stream HEAD / mobile session** — `assertSignedAudioUrl` + Safari cookie timing may block init even when `<audio>` redirect would work.

## 9. Minimal remediation (report only)

1. **Bucket verify:** HEAD `digital-assets/singles/i-dont-believe-you/audio.wav` and `2-heavy/audio.wav` via S3 API (not public CDN); upload if missing per `migrate-r2-bucket.mjs`.
2. **DB:** Run feature `storage_path` backfill; seed album `products` + link `media_assets` for `tbh`/`ad`/`love-hz` tracks in Control System.
3. **Env:** Ensure production `NEXT_PUBLIC_R2_PUBLIC_URL=pub-643e4a94e0184b1fabf6522cfbb16f75.r2.dev`; remove legacy host references.
4. **Do not** rename paths to capitalized `Singles/` / `Features/` without re-uploading objects.
5. **Optional hardening:** Prefer `redirect=1` stream for mobile entitled play; verify R2 **bucket** CORS for storefront origins if keeping JSON+HEAD path.
6. **E2E:** `scripts/test-library-stream-e2e.mjs` with `E2E_SESSION_COOKIE` for entitled feature + album slugs.

---

## Artifacts

| File | Contents |
|------|----------|
| `01-media-inventory.md` | Catalog + R2 key table |
| `02-r2-object-validation.md` | CDN probe results |
| `03-database-paths.md` | DB / resolvePlaybackKey |
| `04-url-validation.md` | URL layers |
| `05-playback-init.md` | AudioContext / stream-client |
| `06-entitlements.md` | AuthZ matrix |
| `07-ui-queue.md` | UI / queue |
| `08-mobile.md` | Mobile notes |
| `curl-probes.txt` | Raw HTTP |
| `stale-path-inventory.txt` | Non-canonical paths |
