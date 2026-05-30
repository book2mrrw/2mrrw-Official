# Phase 3 — Image Failures

## Pipeline

- `src/media/imagePipeline/ImagePipeline.js:23` — `img.onerror` → `reject(new Error("image_load_failed"))`.
- Consumers: `CoverArt.js`, `useArtworkLoader.js`, carousel/queue preloaders — failures degrade to placeholder, no throw to playback.

## Hardcoded catalog paths (`page.js`, `catalog.js`)

| Path | Slug / usage | Local `public/` | Production probe |
|------|--------------|-----------------|------------------|
| `/images/features/idbu.jpg` | `i-dont-believe-you` | Missing locally | **200** |
| `/images/features/2heavy.jpg` | `2-heavy` | Missing locally | **200** |
| `/images/singles/hourglass.jpg` | singles | Missing locally | **200** |
| `/images/singles/w2d.jpg` | singles | Missing locally | (not probed) |
| `/images/albums/*.jpg` | albums / merch placeholders | Missing locally | Served via deploy/R2 |

**Note:** Repo `public/images/` only contains `singles/turnt.jpg`. Production serves other assets from deployment bundle or R2 CDN — not broken URLs in production.

## Stale / orphan risk

- **Local dev:** feature/single JPG 404 possible if env lacks R2 rewrite — cosmetic cover art only.
- **No incorrect path typo found** in `page.js` (idbu, 2heavy naming consistent with migration scripts).

## Action

**No image src changes** in Phase B — production probes green; failures are dev-environment or transient network, not wrong href strings.
