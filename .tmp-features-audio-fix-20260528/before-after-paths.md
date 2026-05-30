# Before / after — feature slugs

## i-dont-believe-you

| Kind | Before | After |
|------|--------|-------|
| Full audio (R2) | `digital-assets/features/i-dont-believe-you/*` | Same (+ `digital-assets/singles/i-dont-believe-you/*` fallback if features folder empty) |
| Preview folder (stream fallback) | `previews/singles/i-dont-believe-you/` (wrong) | `previews/features/i-dont-believe-you/` |
| Legacy preview key | Often missing in query (`preview_path` not selected) | `previews/features/i-dont-believe-you/` from `products.preview_path` |
| Client card preview | `/api/media/preview?folder=previews/features/i-dont-believe-you/` | Unchanged |

## 2-heavy

| Kind | Before | After |
|------|--------|-------|
| Full audio (R2) | `digital-assets/features/2-heavy/*` | Same (+ singles fallback) |
| Preview folder (stream fallback) | `previews/singles/2-heavy/` (wrong) | `previews/features/2-heavy/` |
| Legacy preview key | Often missing | `previews/features/2-heavy/` from DB |
| Client card preview | `/api/media/preview?folder=previews/features/2-heavy/` | Unchanged |
