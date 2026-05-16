# Supabase Storage Architecture

Bucket:

```text
digital-assets/
├── singles/
├── albums/
└── artists/
```

This plan is non-destructive. It does not move, delete, or rename existing media. It gives you a scalable target structure, metadata templates, a manifest, and validation tooling.

## Naming Rules

Use lower-kebab-case for storage folder names:

```text
hour-glass
turnt-me-2-dis
love-hz
01-roll-call
```

Keep display titles in `metadata.json`, not in folder names. This avoids URL encoding issues in Supabase Storage and keeps paths stable for purchases, streaming, Apple Music style pages, lyrics, and future releases.

Canonical filenames inside every release folder:

```text
audio.mp3
preview.mp3
cover.jpg
visual.mp4
lyrics.lrc
metadata.json
```

## Singles

```text
digital-assets/
└── singles/
    └── hour-glass/
        ├── audio.mp3
        ├── preview.mp3
        ├── cover.jpg
        ├── visual.mp4
        ├── lyrics.lrc
        └── metadata.json
```

## Albums

```text
digital-assets/
└── albums/
    └── love-hz/
        ├── album-cover.jpg
        ├── metadata.json
        ├── 01-roll-call/
        │   ├── audio.mp3
        │   ├── preview.mp3
        │   ├── cover.jpg
        │   ├── visual.mp4
        │   ├── lyrics.lrc
        │   └── metadata.json
        └── 02-w2d/
            └── ...
```

## Artists

```text
digital-assets/
└── artists/
    └── 2mrrw/
        ├── avatar.jpg
        ├── hero.jpg
        └── metadata.json
```

## Generated Files

- `storage/digital-assets.manifest.json` — asset inventory and intended Supabase paths.
- `storage/metadata-templates/` — release and artist `metadata.json` templates.
- `scripts/validate-storage-manifest.mjs` — local manifest validator.

## Supabase Storage API Compatibility

Use manifest `storagePath` values with Supabase Storage:

```js
const { data, error } = await supabase.storage
  .from("digital-assets")
  .createSignedUrl("singles/hour-glass/audio.mp3", 3600);
```

Public previews can still be served from public app assets while paid full files stay private in `digital-assets`.

## Upload Order

1. Upload artist metadata/images.
2. Upload album covers and album metadata.
3. Upload single/track covers, previews, and metadata.
4. Upload full audio files.
5. Upload visuals and lyrics.
6. Run validation.

## Validation

Validate manifest shape and optional local asset staging folder:

```bash
node scripts/validate-storage-manifest.mjs
node scripts/validate-storage-manifest.mjs --local-root ./staged-digital-assets
```

The script checks:

- Missing required files under `--local-root`
- Naming consistency
- Metadata template JSON validity
- Cover dimensions when local files exist
- Video aspect ratio when local files exist and `ffprobe` is installed

## Important

Do not update `products.storage_path` to the new structure until the matching files are uploaded to Supabase. Current app paths can keep working while you stage the new storage organization.
