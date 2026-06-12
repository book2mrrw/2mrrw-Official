# Cloudflare R2 Storage Architecture

Production media lives in a **single Cloudflare R2 bucket** (`CLOUDFLARE_R2_BUCKET_NAME`, e.g. `2mrrw-media`). Former Supabase buckets are **path prefixes** inside that bucket:

| Former bucket | R2 key prefix |
|---------------|---------------|
| `digital-assets` | `digital-assets/` |
| `protected-media` | `protected-media/` |

## Layout (digital-assets prefix)

```text
digital-assets/
├── singles/
├── albums/
└── artists/
```

## Layout (protected-media prefix — Control System uploads)

```text
protected-media/
├── masters/
├── previews/
├── artwork/
├── loops/
├── vault/
└── lyrics/
```

## Public vs signed access

| Content | Access |
|---------|--------|
| Previews | Public CDN: `NEXT_PUBLIC_R2_PUBLIC_URL` + `previews/` |
| Artwork / motion loops | Public CDN: `artwork/`, `videos/singles/` |
| Single covers in manifest | `digital-assets/singles/*/cover.jpg` (public when bucket policy allows) |
| Purchased masters / vault | Signed GET via `@aws-sdk/s3-request-presigner` (artist-platform: `/api/library/stream`, `/api/vault/media`; Control System: `/api/media/{assetId}/signed-url`) |

## Signed URL generation (artist-platform)

```js
import { buildR2Key, createR2SignedGetUrl, R2_PREFIX } from "@/lib/storage/r2";

const key = buildR2Key(R2_PREFIX.DIGITAL_ASSETS, product.storage_path);
const url = await createR2SignedGetUrl(key, 3600);
```

Playback for entitled users: `resolvePlaybackSrc()` returns `/api/library/stream?slug=…&redirect=1`, which redirects to the signed R2 URL.

## Environment variables

```text
CLOUDFLARE_R2_ENDPOINT
CLOUDFLARE_R2_ACCESS_KEY_ID
CLOUDFLARE_R2_SECRET_ACCESS_KEY
CLOUDFLARE_R2_BUCKET_NAME
NEXT_PUBLIC_R2_PUBLIC_URL
```

## Generated files

- `storage/digital-assets.manifest.json` — asset inventory (paths under `digital-assets/` prefix).
- `storage/metadata-templates/` — release and artist `metadata.json` templates.
- `scripts/validate-storage-manifest.mjs` — manifest validator (reports R2 bucket + prefix).
- `scripts/verify-setup.mjs` — includes R2 `HeadBucket` connectivity check.

## cover_url normalization

Store `products.cover_url` **without** a leading slash (e.g. `images/singles/hourglass.jpg`). UI resolves via `catalogCoverUrl()` → public R2 when configured.

## SQL (optional DB cleanup)

```sql
-- Normalize legacy leading slashes on cover_url
UPDATE products SET cover_url = ltrim(cover_url, '/') WHERE cover_url LIKE '/%';
```

## Important

Do not update `products.storage_path` until matching objects exist at `digital-assets/{storage_path}` in R2.
