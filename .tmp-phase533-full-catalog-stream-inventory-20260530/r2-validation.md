# R2 Validation — Phase 5.3.3

---

## Summary

| Check | Result |
|-------|--------|
| Registered stream keys HEAD-checked | **26 / 26 (100%)** |
| Missing R2 objects for registered keys | **0** |
| Orphan R2 objects (unregistered) | Not audited (out of scope) |
| Master objects modified | **0** (verified — pipeline read-only on `digital-assets/`) |

---

## Validation method

`scripts/phase533-full-catalog-validation.mjs` calls `headR2ObjectKey()` for each registered `stream_key` and cross-checks resolver `tryResolveStreamPlaybackKey()` with live HEAD gate.

---

## Stream object profile

| Property | Value |
|----------|-------|
| Codec | AAC-LC |
| Bitrate | 192 kbps |
| Container | M4A |
| Optimization | `+faststart` (moov atom front) |
| Key pattern | `streaming/{release_type}/{slug}/{slug}_192.m4a` |
| Track key pattern | `streaming/{release_type}/{album}/{track}/{track}_192.m4a` |

---

## Registered keys validated (26)

### Products (6)

- `streaming/singles/hour-glass/hour-glass_192.m4a` ✅
- `streaming/singles/artificial/artificial_192.m4a` ✅
- `streaming/singles/turnt-me-2-dis/turnt-me-2-dis_192.m4a` ✅
- `streaming/singles/w2d/w2d_192.m4a` ✅
- `streaming/features/2-heavy/2-heavy_192.m4a` ✅
- `streaming/features/i-dont-believe-you/i-dont-believe-you_192.m4a` ✅

### Catalog tracks (20)

All 20 registered track stream keys returned successful HEAD. See `generation-coverage.md` for full key list.

---

## Failed master paths (not in streaming/)

10 tracks have no stream object because source master was not found in `digital-assets/`. These paths were probed but no transcode occurred:

- `digital-assets/mixtapes-and-eps/ad/03-said-n-done/`
- `digital-assets/mixtapes-and-eps/ad/04-a-d-d/`
- `digital-assets/mixtapes-and-eps/ad/08-life-changes-ft-gwendolyn/`
- `digital-assets/mixtapes-and-eps/love-hz-vol-1/01-roll-call/`
- `digital-assets/mixtapes-and-eps/love-hz-vol-1/02-w-2-d/`
- `digital-assets/mixtapes-and-eps/love-hz-vol-1/07-stayed-2-long/`
- `digital-assets/mixtapes-and-eps/love-hz-vol-1/08-knock-on-wood/`
- `digital-assets/mixtapes-and-eps/love-hz-vol-1/09-hour-glass/`
- `digital-assets/mixtapes-and-eps/tbh/03-unxpcted/`
- `digital-assets/mixtapes-and-eps/tbh/08-2late/`
