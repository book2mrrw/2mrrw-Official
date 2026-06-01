# DB Registrations — Phase 5.3.3B

**Tables updated:** `catalog_tracks.stream_path`, `catalog_tracks.stream_key`  
**Method:** `registerStreamAsset()` via backfill pipeline (no manual SQL)

## Newly registered tracks (9)

| Album | Track | stream_path | stream_key |
|-------|-------|-------------|------------|
| ad | 03-said-n-done | `streaming/mixtapes-and-eps/ad/03-said-n-done/` | `streaming/mixtapes-and-eps/ad/03-said-n-done/03-said-n-done_192.m4a` |
| ad | 04-a-d-d | `streaming/mixtapes-and-eps/ad/04-a-d-d/` | `streaming/mixtapes-and-eps/ad/04-a-d-d/04-a-d-d_192.m4a` |
| ad | 08-life-changes-ft-gwendolyn | `streaming/mixtapes-and-eps/ad/08-life-changes-ft-gwendolyn/` | `streaming/mixtapes-and-eps/ad/08-life-changes-ft-gwendolyn/08-life-changes-ft-gwendolyn_192.m4a` |
| love-hz-vol-1 | 02-w-2-d | `streaming/mixtapes-and-eps/love-hz-vol-1/02-w-2-d/` | `streaming/mixtapes-and-eps/love-hz-vol-1/02-w-2-d/02-w-2-d_192.m4a` |
| love-hz-vol-1 | 07-stayed-2-long | `streaming/mixtapes-and-eps/love-hz-vol-1/07-stayed-2-long/` | `streaming/mixtapes-and-eps/love-hz-vol-1/07-stayed-2-long/07-stayed-2-long_192.m4a` |
| love-hz-vol-1 | 08-knock-on-wood | `streaming/mixtapes-and-eps/love-hz-vol-1/08-knock-on-wood/` | `streaming/mixtapes-and-eps/love-hz-vol-1/08-knock-on-wood/08-knock-on-wood_192.m4a` |
| love-hz-vol-1 | 09-hour-glass | `streaming/mixtapes-and-eps/love-hz-vol-1/09-hour-glass/` | `streaming/mixtapes-and-eps/love-hz-vol-1/09-hour-glass/09-hour-glass_192.m4a` |
| tbh | 03-unxpcted | `streaming/mixtapes-and-eps/tbh/03-unxpcted/` | `streaming/mixtapes-and-eps/tbh/03-unxpcted/03-unxpcted_192.m4a` |
| tbh | 08-2late | `streaming/mixtapes-and-eps/tbh/08-2late/` | `streaming/mixtapes-and-eps/tbh/08-2late/08-2late_192.m4a` |

## Still unregistered (1)

| Album | Track | stream_path | stream_key | Blocker |
|-------|-------|-------------|------------|---------|
| love-hz-vol-1 | 01-roll-call | — | — | Master not uploaded to R2 |

## Cumulative catalog registration

| Metric | Before (5.3.3) | After (5.3.3B) | Delta |
|--------|----------------|----------------|-------|
| Registered | 26 / 36 | **35 / 36** | **+9** |
| Unregistered | 10 | **1** | **−9** |
