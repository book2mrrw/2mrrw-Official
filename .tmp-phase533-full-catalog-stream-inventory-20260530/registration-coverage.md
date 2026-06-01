# Registration Coverage — Phase 5.3.3

**Target:** Populate `products.stream_path` / `stream_key` and `catalog_tracks.stream_path` / `stream_key`  
**Achieved:** 26 / 36 playable assets (**72.2%**)

---

## By table

| Table | Rows with `storage_path` | `stream_key` populated | Coverage |
|-------|--------------------------|------------------------|----------|
| `products` | 6 | 6 | **100%** |
| `catalog_tracks` | 30 | 20 | **66.7%** |
| **Combined** | **36** | **26** | **72.2%** |

---

## Registration validation

All 26 registered rows have **both** `stream_path` and `stream_key` populated. Validation regex accepts hyphenated slugs (fixed in Phase 5.3.1).

Sample registration shape:

```
stream_path: streaming/mixtapes-and-eps/ad/02-here-i-come/
stream_key:  streaming/mixtapes-and-eps/ad/02-here-i-come/02-here-i-come_192.m4a
```

---

## Unregistered (10)

| Entity | Reason |
|--------|--------|
| `track:ad/03-said-n-done` | Backfill failed — no stream generated |
| `track:ad/04-a-d-d` | Backfill failed — no stream generated |
| `track:ad/08-life-changes-ft-gwendolyn` | Backfill failed — no stream generated |
| `track:love-hz-vol-1/01-roll-call` | Backfill failed — no stream generated |
| `track:love-hz-vol-1/02-w-2-d` | Backfill failed — no stream generated |
| `track:love-hz-vol-1/07-stayed-2-long` | Backfill failed — no stream generated |
| `track:love-hz-vol-1/08-knock-on-wood` | Backfill failed — no stream generated |
| `track:love-hz-vol-1/09-hour-glass` | Backfill failed — no stream generated |
| `track:tbh/03-unxpcted` | Backfill failed — no stream generated |
| `track:tbh/08-2late` | Backfill failed — no stream generated |

No partial registrations — failed items retain null stream columns and fall back to master playback.

---

## Path to 100%

1. Upload missing masters to R2 `digital-assets/` at paths matching `storage_path`
2. Re-run: `FFMPEG_PATH=node_modules/ffmpeg-static/ffmpeg npm run backfill:stream-assets -- --yes`
3. Script skips 26 completed; processes 10 remaining only
