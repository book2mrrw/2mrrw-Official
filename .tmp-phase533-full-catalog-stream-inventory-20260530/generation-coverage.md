# Generation Coverage — Phase 5.3.3

**Profile:** AAC-LC 192 kbps +faststart from authoritative masters → R2 `streaming/`  
**Tooling:** `ffmpeg-static` via `FFMPEG_PATH=node_modules/ffmpeg-static/ffmpeg`

---

## Run summary

| Run | Command | Processed | Generated | Failed | Skipped |
|-----|---------|-----------|-----------|--------|---------|
| Phase 5.3.1 canary | `--yes --slug …` (targeted) | 9 | 8 | 1 | — |
| Phase 5.3.3 full | `--yes --checkpoint .backfill-stream-phase533.json` | 28 | 18 | 10 | 8 pre-registered |

**Cumulative stream objects in R2:** 26

---

## Phase 5.3.3 generation detail

| Metric | Value |
|--------|-------|
| Candidates at run start | 28 catalog_tracks (0 products — all 6 already registered) |
| Pre-skipped (already registered) | 8 (6 products + 2 canary tracks via DB `stream_key` filter) |
| Transcode + upload success | **18** |
| Transcode failures | **10** (`master_not_found`) |
| Success rate (this run) | **64.3%** (18/28) |
| Elapsed time | ~28 minutes |

---

## New stream keys generated (Phase 5.3.3)

| Album | Track | Stream key |
|-------|-------|------------|
| `ad` | `02-here-i-come` | `streaming/mixtapes-and-eps/ad/02-here-i-come/02-here-i-come_192.m4a` |
| `ad` | `05-perspective` | `streaming/mixtapes-and-eps/ad/05-perspective/05-perspective_192.m4a` |
| `ad` | `06-grand-scheme` | `streaming/mixtapes-and-eps/ad/06-grand-scheme/06-grand-scheme_192.m4a` |
| `ad` | `07-a2b` | `streaming/mixtapes-and-eps/ad/07-a2b/07-a2b_192.m4a` |
| `ad` | `09-itself` | `streaming/mixtapes-and-eps/ad/09-itself/09-itself_192.m4a` |
| `ad` | `10-wastin-time` | `streaming/mixtapes-and-eps/ad/10-wastin-time/10-wastin-time_192.m4a` |
| `ad` | `11-like-me-or-not` | `streaming/mixtapes-and-eps/ad/11-like-me-or-not/11-like-me-or-not_192.m4a` |
| `love-hz-vol-1` | `03-guarded-heart` | `streaming/mixtapes-and-eps/love-hz-vol-1/03-guarded-heart/03-guarded-heart_192.m4a` |
| `love-hz-vol-1` | `04-all-love-it` | `streaming/mixtapes-and-eps/love-hz-vol-1/04-all-love-it/04-all-love-it_192.m4a` |
| `love-hz-vol-1` | `05-like-u-do` | `streaming/mixtapes-and-eps/love-hz-vol-1/05-like-u-do/05-like-u-do_192.m4a` |
| `love-hz-vol-1` | `06-tell-me` | `streaming/mixtapes-and-eps/love-hz-vol-1/06-tell-me/06-tell-me_192.m4a` |
| `love-hz-vol-1` | `10-turnt-me-2-dis` | `streaming/mixtapes-and-eps/love-hz-vol-1/10-turnt-me-2-dis/10-turnt-me-2-dis_192.m4a` |
| `tbh` | `02-up-2-me` | `streaming/mixtapes-and-eps/tbh/02-up-2-me/02-up-2-me_192.m4a` |
| `tbh` | `04-all-yours` | `streaming/mixtapes-and-eps/tbh/04-all-yours/04-all-yours_192.m4a` |
| `tbh` | `05-locomotive` | `streaming/mixtapes-and-eps/tbh/05-locomotive/05-locomotive_192.m4a` |
| `tbh` | `06-left` | `streaming/mixtapes-and-eps/tbh/06-left/06-left_192.m4a` |
| `tbh` | `07-was-wrong` | `streaming/mixtapes-and-eps/tbh/07-was-wrong/07-was-wrong_192.m4a` |
| `tbh` | `09-artificial` | `streaming/mixtapes-and-eps/tbh/09-artificial/09-artificial_192.m4a` |

---

## Resumability verified

- Checkpoint: `.backfill-stream-phase533.json` (18 completed, 10 failed)
- Re-run with `--yes` skips DB-registered items automatically
- Failed items remain unregistered and will be retried after master upload
