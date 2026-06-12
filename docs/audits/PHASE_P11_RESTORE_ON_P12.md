# Phase P11 + P11B on P12 Baseline — Restore Verification

**Date:** 2026-06-03  
**Baseline:** `d1617e2` — Phase P12 playback-triggered storefront reconciliation  
**Original fixes:** `c9aa914` (P11), `6887096` (P11B)

---

## Result: no code restore required

P11 and P11B are **already ancestors** of `main` at `d1617e2`. P12 was built on top of them; the MP4 path integrity layer was not removed by the production restore to P12.

| Check | Outcome |
|-------|---------|
| `git merge-base --is-ancestor c9aa914 HEAD` | yes |
| `git merge-base --is-ancestor 6887096 HEAD` | yes |
| Cherry-pick `c9aa914` | **Aborted** — add/add conflict on `resolve-concrete-video-key.js` only; HEAD already contains P11B superset |
| `git diff d1617e2 6887096` (media paths) | **Empty** — no P11/P11B file delta vs P12 |

### Preserved implementation (unchanged on P12)

- `src/lib/media/resolve-concrete-video-key.js` — flat → nested R2 keys, albums/features, `deriveNestedVideoKeyFromFlatPath`
- `src/lib/media-urls.js` — `catalogMotionVideoUrl` → `resolveConcreteVideoR2Key`
- `src/lib/media/r2-catalog-media.js`, `src/components/home/catalogMedia.js`
- `src/components/home/CatalogGrid.js`, `src/lib/music-playback.js`
- `src/components/home/LatestSinglesStyleRow.js` — P12 adds `memo(SinglesStyleCard)` (intentional; not reverted)

### Explicitly not restored (per user)

Wake/mobile audio, FULL_FIX visibility, AudioContext gesture commits (`9768269`, `594c970`, `36fab23`–`ebaf979`, etc.).

---

## Validation (2026-06-03)

```bash
npm run build                          # PASS
npm run check:frontend-guardrails      # 0 errors, 3 pre-existing page.js warnings
```

### R2 CDN HEAD (`pub-643e4a94e0184b1fabf6522cfbb16f75.r2.dev`)

| Path | HTTP | Content-Type |
|------|------|--------------|
| `videos/singles/hour-glass/hourglass.mp4` | 200 | video/mp4 |
| `videos/singles/w2d/w2d.mp4` | 200 | video/mp4 |
| `videos/singles/artificial/artificial.mp4` | 200 | video/mp4 |
| `videos/singles/turnt-me-2-dis/turntme2dis.mp4` | 200 | video/mp4 |
| `videos/singles/hourglass.mp4` (flat) | 404 | text/plain |
| `videos/singles/turntme2dis.mp4` (flat) | 404 | text/plain |

---

## Related audits

- [PHASE_P11_MP4_SOURCE_INTEGRITY_REPAIR.md](./PHASE_P11_MP4_SOURCE_INTEGRITY_REPAIR.md)
- [PHASE_P11B_STOREFRONT_MP4_COVERAGE.md](./PHASE_P11B_STOREFRONT_MP4_COVERAGE.md)
- [PHASE_P12_PLAYBACK_TRIGGERED_RECONCILIATION_ELIMINATION.md](./PHASE_P12_PLAYBACK_TRIGGERED_RECONCILIATION_ELIMINATION.md)
