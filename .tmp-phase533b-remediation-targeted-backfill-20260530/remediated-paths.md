# Remediated R2 Paths — Phase 5.3.3B

**Run date:** 2026-05-31  
**Bucket:** `2mrrw-media`  
**Method:** Copy + size-verify + delete (preserves object contents; no DB changes)

## Category A — Slug alignment (6 tracks)

| Track | From (R2 prefix) | To (canonical prefix) | Objects | Reason |
|-------|------------------|----------------------|---------|--------|
| ad/03-said-n-done | `…/ad/03-said-n-done ` | `…/ad/03-said-n-done` | 1 | `R2_SLUG_TRAILING_SPACE` |
| ad/04-a-d-d | `…/ad/04-a.d.d` | `…/ad/04-a-d-d` | 1 | `R2_SLUG_PUNCTUATION` |
| ad/08-life-changes-ft-gwendolyn | `…/ad/08-life-changes ft. gwendolyn` | `…/ad/08-life-changes-ft-gwendolyn` | 1 | `R2_SLUG_SPACES_NOT_HYPHENS` |
| love-hz-vol-1/02-w-2-d | `…/love-hz-vol-1/02-w2d` | `…/love-hz-vol-1/02-w-2-d` | 1 | `R2_SLUG_COMPACT` |
| tbh/03-unxpcted | `…/tbh/03-unxpected` | `…/tbh/03-unxpcted` | 1 | `R2_SLUG_SPELLING` |
| tbh/08-2late | `…/tbh/08-2late?` | `…/tbh/08-2late` | 3 | `R2_SLUG_PUNCTUATION` |

## Category C — love-hz-vol-1 track number realignment (3 tracks)

Staging prefix: `digital-assets/.tmp-phase533b-staging/` (cleared after finalize)

| Track | From | Via staging | To |
|-------|------|-------------|-----|
| 07-stayed-2-long | `09-stayed-2-long` | `…/love-hz-vol-1--07-stayed-2-long` | `07-stayed-2-long` |
| 08-knock-on-wood | `07-knock-on-wood` | `…/love-hz-vol-1--08-knock-on-wood` | `08-knock-on-wood` |
| 09-hour-glass | `08-hour-glass` | `…/love-hz-vol-1--09-hour-glass` | `09-hour-glass` |

## Object-level move log

| From key | To key | Bytes |
|----------|--------|------:|
| `digital-assets/mixtapes-and-eps/ad/03-said-n-done /Said N' Done (A.D).wav` | `…/03-said-n-done/Said N' Done (A.D).wav` | 42,303,546 |
| `…/ad/04-a.d.d/A.D.D.wav` | `…/04-a-d-d/A.D.D.wav` | 27,353,576 |
| `…/08-life-changes ft. gwendolyn/Life Changes ft. Gwendolyn.mp3` | `…/08-life-changes-ft-gwendolyn/Life Changes ft. Gwendolyn.mp3` | 8,801,092 |
| `…/love-hz-vol-1/02-w2d/W.2.D x 3.wav` | `…/02-w-2-d/W.2.D x 3.wav` | 52,943,316 |
| `…/tbh/03-unxpected/Unxpected.wav` | `…/03-unxpcted/Unxpected.wav` | 34,535,538 |
| `…/tbh/08-2late?/2Late? (T.B.H).mp3` | `…/08-2late/2Late? (T.B.H).mp3` | 8,739,526 |
| `…/tbh/08-2late?/2Late?(T.B.H).wav` | `…/08-2late/2Late?(T.B.H).wav` | 57,800,754 |
| `…/tbh/08-2late?/2Late?.mp3.mp3` | `…/08-2late/2Late?.mp3.mp3` | 8,669,435 |
| `…/09-stayed-2-long/Stayed 2 Long x 2mrrw (Rough Final).wav` | `…/07-stayed-2-long/Stayed 2 Long x 2mrrw (Rough Final).wav` | 29,523,812 |
| `…/07-knock-on-wood/Knock On Wood (EXP) .wav` | `…/08-knock-on-wood/Knock On Wood (EXP) .wav` | 55,979,238 |
| `…/08-hour-glass/Hour Glass (EVEN).wav` | `…/09-hour-glass/Hour Glass (EVEN).wav` | 31,638,788 |

**Total objects moved:** 12 (9 unique track folders)  
**Failures:** 0  
**Code changes:** None (no alias/fallback logic added)
