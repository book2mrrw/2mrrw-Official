# Mismatch matrix — Expected vs Actual R2 keys

**Probe date:** 2026-05-31 (live R2, read-only)  
**Expected** = path derived from `catalog_tracks.storage_path` via `normalizeStoragePathForStorefront` + non-recursive discovery.

| # | Track | Expected entity prefix (discovery target) | Actual R2 entity prefix (audio present) | Actual filename | Reason code |
|---|-------|-------------------------------------------|----------------------------------------|-----------------|-------------|
| 1 | ad/03-said-n-done | `digital-assets/mixtapes-and-eps/ad/03-said-n-done/` | `digital-assets/mixtapes-and-eps/ad/03-said-n-done /` | `Said N' Done (A.D).wav` | `R2_SLUG_TRAILING_SPACE` |
| 2 | ad/04-a-d-d | `…/ad/04-a-d-d/` | `…/ad/04-a.d.d/` | `A.D.D.wav` | `R2_SLUG_PUNCTUATION` (dots vs hyphens) |
| 3 | ad/08-life-changes-ft-gwendolyn | `…/ad/08-life-changes-ft-gwendolyn/` | `…/ad/08-life-changes ft. gwendolyn/` | `Life Changes ft. Gwendolyn.mp3` | `R2_SLUG_SPACES_NOT_HYPHENS` |
| 4 | love-hz-vol-1/01-roll-call | `…/love-hz-vol-1/01-roll-call/` | *(none)* | — | `MASTER_ABSENT` |
| 5 | love-hz-vol-1/02-w-2-d | `…/love-hz-vol-1/02-w-2-d/` | `…/love-hz-vol-1/02-w2d/` | `W.2.D x 3.wav` | `R2_SLUG_COMPACT` (`w2d` vs `w-2-d`) |
| 6 | love-hz-vol-1/07-stayed-2-long | `…/love-hz-vol-1/07-stayed-2-long/` | `…/love-hz-vol-1/09-stayed-2-long/` | `Stayed 2 Long x 2mrrw (Rough Final).wav` | `R2_TRACK_NUMBER_DRIFT` (+2) |
| 7 | love-hz-vol-1/08-knock-on-wood | `…/love-hz-vol-1/08-knock-on-wood/` | `…/love-hz-vol-1/07-knock-on-wood/` | `Knock On Wood (EXP) .wav` | `R2_TRACK_NUMBER_DRIFT` (−1) |
| 8 | love-hz-vol-1/09-hour-glass | `…/love-hz-vol-1/09-hour-glass/` | `…/love-hz-vol-1/08-hour-glass/` | `Hour Glass (EVEN).wav` | `R2_TRACK_NUMBER_DRIFT` (−1) |
| 9 | tbh/03-unxpcted | `…/tbh/03-unxpcted/` | `…/tbh/03-unxpected/` | `Unxpected.wav` | `R2_SLUG_SPELLING` |
| 10 | tbh/08-2late | `…/tbh/08-2late/` | `…/tbh/08-2late?/` | `2Late? (T.B.H).mp3` (+ duplicates) | `R2_SLUG_PUNCTUATION` (`?` in folder) |

## Reason code legend

| Code | Meaning |
|------|---------|
| `R2_SLUG_TRAILING_SPACE` | Folder name differs by whitespace |
| `R2_SLUG_PUNCTUATION` | Dots, `?`, or other chars vs kebab slug |
| `R2_SLUG_SPACES_NOT_HYPHENS` | Human title used as folder segment |
| `R2_SLUG_COMPACT` | Abbreviated slug (`w2d` vs `w-2-d`) |
| `R2_SLUG_SPELLING` | Typo variant (`unxpected` vs `unxpcted`) |
| `R2_TRACK_NUMBER_DRIFT` | Correct title, wrong `NN-` prefix on R2 |
| `MASTER_ABSENT` | No audio under canonical or searched aliases |

## love-hz-vol-1 folder inventory (R2 vs DB)

| DB track # | DB slug | R2 folder with audio? |
|------------|---------|----------------------|
| 1 | 01-roll-call | **No** |
| 2 | 02-w-2-d | **02-w2d** (slug mismatch) |
| 3–6 | guarded-heart … tell-me | Match |
| 7 | 07-stayed-2-long | Audio under **09-stayed-2-long** |
| 8 | 08-knock-on-wood | Audio under **07-knock-on-wood** |
| 9 | 09-hour-glass | Audio under **08-hour-glass** |
| 10 | 10-turnt-me-2-dis | Match |

Missing `01-roll-call` likely shifted subsequent numeric prefixes on upload (off-by-one from track 7 onward).

## Related duplicate (not used by backfill)

| Track | Note |
|-------|------|
| love-hz-vol-1/02-w-2-d | Also `digital-assets/singles/w2d/audio.mp3` (single product) — EP backfill does not cross-reference |
