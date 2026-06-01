# love-hz-vol-1/01-roll-call — Special Case Audit

**Track:** Roll Call  
**Album:** love-hz-vol-1 (EP)  
**Status:** **MASTER_ABSENT** — blocked on content upload, not resolver/code

---

## Findings

| Check | Result |
|-------|--------|
| DB `storage_path` | `mixtapes-and-eps/love-hz-vol-1/01-roll-call/` |
| Normalized R2 prefix | `digital-assets/mixtapes-and-eps/love-hz-vol-1/01-roll-call/` |
| Objects under canonical prefix | **None** |
| Broad search `roll-call` under `digital-assets/` | **No hits** |
| `resolveAudioFile()` | **null** |
| Stream backfill | **Skipped** (no master to transcode) |
| DB `stream_path` / `stream_key` | **Unset** |

## R2 folder inventory (love-hz-vol-1 post-remediation)

| DB track # | DB slug | R2 folder (audio) |
|------------|---------|-------------------|
| 1 | 01-roll-call | **Missing** |
| 2 | 02-w-2-d | ✅ `02-w-2-d` (remediated from `02-w2d`) |
| 3–6 | guarded-heart … tell-me | ✅ Match (unchanged) |
| 7 | 07-stayed-2-long | ✅ Remediated from `09-stayed-2-long` |
| 8 | 08-knock-on-wood | ✅ Remediated from `07-knock-on-wood` |
| 9 | 09-hour-glass | ✅ Remediated from `08-hour-glass` |
| 10 | 10-turnt-me-2-dis | ✅ Match (unchanged) |

## Root cause hypothesis

Track 1 was never uploaded during bulk ingest. Subsequent tracks 7–9 used off-by-one numbering on R2 (now corrected in 5.3.3B Category C). The missing opener explains the numeric drift pattern identified in Phase 5.3.3A.

## Related assets (not substitutes)

| Path | Note |
|------|------|
| `digital-assets/singles/w2d/audio.mp3` | Single product for W.2.D — separate from EP track 2 |
| No `roll-call` single or feature | No cross-reference available |

## Required action

Upload master (WAV/FLAC/MP3) to:

```
digital-assets/mixtapes-and-eps/love-hz-vol-1/01-roll-call/
```

Then run:

```bash
FFMPEG_PATH=node_modules/ffmpeg-static/ffmpeg \
  npm run backfill:stream-assets -- --yes --force \
  --album-slug love-hz-vol-1 --slug 01-roll-call
```

## Impact on phase outcome

- Does **not** block the other 9 remediated tracks
- Catalog coverage capped at **35/36 (97.2%)** until upload completes
- Overall phase result: **CONDITIONAL PASS**
