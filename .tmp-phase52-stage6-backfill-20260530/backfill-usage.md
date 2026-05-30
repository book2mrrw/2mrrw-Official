# Stream Asset Backfill — Usage Guide

**Phase 5.2 Stage 6** — Manual CLI only. Never auto-runs on deploy or startup.

---

## Prerequisites

1. **Supabase + R2 credentials** in `.env.local`:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - R2 vars used by existing storage layer (`CLOUDFLARE_R2_*`)

2. **Stream migration applied** (for live runs):
   - `supabase/migrations/20260530160000_stream_asset_registration.sql`
   - Dry-run works before migration; live persist requires `stream_path` / `stream_key` columns.

3. **ffmpeg** (live runs only):
   - On PATH or set `FFMPEG_PATH`
   - Not required for `--dry-run`
   - If absent, live runs fail per-item with `ffmpeg unavailable` and continue

---

## Gate

The script refuses to run unless **both** are true, or you pass `--yes`:

| Env var | Required value |
|---------|----------------|
| `HYBRID_STREAMING_ENABLED` | `1` or `true` |
| `AUTO_GENERATE_STREAM_ASSETS` | `1` or `true` |

`--yes` sets both flags for the current process only (does not modify `.env.local` or production).

---

## Commands

```bash
# Enumerate candidates — no transcode, no R2 writes, no DB updates
npm run backfill:stream-assets -- --yes --dry-run

# Process one product (singles/features)
npm run backfill:stream-assets -- --yes --slug hour-glass

# Process one album track
npm run backfill:stream-assets -- --yes --album-slug ad --slug 01-2mrrws-ntro

# Reprocess items that already have stream registration
npm run backfill:stream-assets -- --yes --force --limit 5

# Custom checkpoint location
npm run backfill:stream-assets -- --yes --checkpoint ./ops/my-checkpoint.json
```

---

## What gets processed

| Source | Condition |
|--------|-----------|
| `products` | `storage_path` set (master exists) AND no `stream_path` / `stream_key` (column or metadata), unless `--force` |
| `catalog_tracks` | Same logic for per-track masters on albums / mixtapes / EPs |

**Never modified:** objects under `digital-assets/` (masters). The pipeline only **reads** masters, writes new objects under `streaming/`, and updates stream registration columns.

---

## Resume behavior

Checkpoint file (default): `.backfill-stream-checkpoint.json` at repo root.

```json
{
  "version": 1,
  "updatedAt": "2026-05-30T…",
  "completed": [
    {
      "kind": "product",
      "slug": "hour-glass",
      "completedAt": "…",
      "stream_key": "streaming/singles/hour-glass/hour-glass_192.m4a"
    }
  ],
  "failed": [
    {
      "kind": "catalog_track",
      "album_slug": "ad",
      "slug": "01-2mrrws-ntro",
      "failedAt": "…",
      "error": "master_not_found"
    }
  ]
}
```

- **Completed slugs are skipped** on subsequent runs.
- **`--force`** reprocesses even when stream exists or checkpoint marks complete.
- **Failed items** stay in `failed[]` but are retried on the next run (not in `completed`).
- Delete or edit the checkpoint file to reset progress.

---

## Failure handling

- **Per-item errors** are logged and recorded in checkpoint `failed[]`; the script **continues** with remaining items.
- Exit code `1` if any item failed in the current run.
- Common errors:
  - `master_not_found` — no resolvable master in R2 for `storage_path`
  - `ffmpeg unavailable` — install ffmpeg or set `FFMPEG_PATH`
  - `invalid_or_missing_release_type` — fix product metadata or rely on storage_path inference
  - Column errors on persist — apply Stage 2 migration

---

## Rollback

**Do not run the script** to roll back. To undo stream assets:

1. Set `HYBRID_STREAMING_ENABLED=0` (and related flags) — playback reverts to master-only (Stage 4 fallback).
2. Optionally delete `streaming/` objects in R2 (manual ops).
3. Optionally null `stream_path` / `stream_key` on affected rows (manual SQL).
4. Delete `.backfill-stream-checkpoint.json` if restarting backfill later.

Masters in `digital-assets/` are never touched by this tool.

---

## CI / ffmpeg absent

`--dry-run` validates CLI, gating, Supabase queries, and candidate enumeration **without ffmpeg or transcode**. Safe for CI when `.env.local` (or injected env) provides Supabase credentials.
