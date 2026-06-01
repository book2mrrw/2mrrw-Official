# Generated Streams — Phase 5.3.3B Targeted Backfill

**Run date:** 2026-05-31  
**Encoder:** AAC-LC 192 kbps +faststart via `ffmpeg-static`  
**Command pattern:** `FFMPEG_PATH=node_modules/ffmpeg-static/ffmpeg npm run backfill:stream-assets -- --yes --force --album-slug <album> --slug <track> --checkpoint .backfill-stream-phase533b.json`

## New stream assets (9 tracks)

| Album | Track | Master source (post-remediation) | Stream key |
|-------|-------|----------------------------------|------------|
| ad | 03-said-n-done | `…/03-said-n-done/Said N' Done (A.D).wav` | `streaming/mixtapes-and-eps/ad/03-said-n-done/03-said-n-done_192.m4a` |
| ad | 04-a-d-d | `…/04-a-d-d/A.D.D.wav` | `streaming/mixtapes-and-eps/ad/04-a-d-d/04-a-d-d_192.m4a` |
| ad | 08-life-changes-ft-gwendolyn | `…/08-life-changes-ft-gwendolyn/Life Changes ft. Gwendolyn.mp3` | `streaming/mixtapes-and-eps/ad/08-life-changes-ft-gwendolyn/08-life-changes-ft-gwendolyn_192.m4a` |
| love-hz-vol-1 | 02-w-2-d | `…/02-w-2-d/W.2.D x 3.wav` | `streaming/mixtapes-and-eps/love-hz-vol-1/02-w-2-d/02-w-2-d_192.m4a` |
| love-hz-vol-1 | 07-stayed-2-long | `…/07-stayed-2-long/Stayed 2 Long x 2mrrw (Rough Final).wav` | `streaming/mixtapes-and-eps/love-hz-vol-1/07-stayed-2-long/07-stayed-2-long_192.m4a` |
| love-hz-vol-1 | 08-knock-on-wood | `…/08-knock-on-wood/Knock On Wood (EXP) .wav` | `streaming/mixtapes-and-eps/love-hz-vol-1/08-knock-on-wood/08-knock-on-wood_192.m4a` |
| love-hz-vol-1 | 09-hour-glass | `…/09-hour-glass/Hour Glass (EVEN).wav` | `streaming/mixtapes-and-eps/love-hz-vol-1/09-hour-glass/09-hour-glass_192.m4a` |
| tbh | 03-unxpcted | `…/03-unxpcted/Unxpected.wav` | `streaming/mixtapes-and-eps/tbh/03-unxpcted/03-unxpcted_192.m4a` |
| tbh | 08-2late | `…/08-2late/2Late?(T.B.H).wav` | `streaming/mixtapes-and-eps/tbh/08-2late/08-2late_192.m4a` |

## Skipped (master absent)

| Album | Track | Reason |
|-------|-------|--------|
| love-hz-vol-1 | 01-roll-call | `MASTER_ABSENT` — no audio under canonical or alias paths |

## Backfill summary

| Metric | Value |
|--------|-------|
| Target tracks | 9 (of 10 failed in 5.3.3) |
| Transcode success | **9 / 9** |
| Transcode failures | **0** |
| Run duration | ~41 min (includes redundant product re-processing per iteration) |
| Checkpoint | `.backfill-stream-phase533b.json` |

All 9 stream objects HEAD-confirmed in R2 during post-run validation.
