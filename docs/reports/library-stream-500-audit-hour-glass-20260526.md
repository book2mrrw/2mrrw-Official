# Library Stream 500 Audit — `hour-glass` slug

**Date:** 2026-05-26  
**Scope:** READ ONLY audit of `/api/library/stream` 500 (`Stream unavailable`) for slug `hour-glass`  
**Project:** `artist-platform`  
**Supabase project queried:** `2MRRW-Frontend Project` (`qvfbgkbgczyqrglvgyqr`)

---

## Executive summary

For slug `hour-glass`, the database row exists with a valid `storage_path`. Missing playback key and missing product both return **404**, not 500. A **500** only occurs when an exception is thrown inside `buildStreamResponse` and caught by the GET handler.

**Most likely 500 causes (ordered):**

1. **R2 presign failure** — `createR2SignedGetUrl` has no env guard; missing/invalid `CLOUDFLARE_R2_*` credentials throw from the AWS SDK during signing.
2. **Supabase admin bootstrap failure** — `createAdminClient()` throws `"Missing Supabase admin credentials"` if `NEXT_PUBLIC_SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY` is absent.
3. **Entitlement / catalog DB errors** — `userCanStreamProduct` and related helpers re-throw Supabase query errors (not swallowed).
4. **`resolvePlaybackKey` query error** — products lookup uses `if (error) throw error` (500), distinct from “no row” which returns `null` → 404.
5. **`stream_sessions` / `stream_events` insert errors** — tables exist in prod; insert failures throw (unlike missing-table case, which is handled gracefully).

**Not a 500 for hour-glass (confirmed):**

- Product missing → 404 `Product not found`
- No R2 key resolved → 404 `No downloadable asset for this item`
- Not entitled → 403
- Concurrent stream → 409
- No session → 401

---

## 1. `src/lib/playback/resolve-playback-key.js`

### R2 key resolution by slug

**Primary query** — table `products`, matched on column `slug`:

```js
const { data: product, error } = await admin
  .from("products")
  .select("id, slug, storage_path, content_type, content_id, metadata")
  .eq("slug", slug)
  .maybeSingle();
```

**Fallback path resolution** (when `products.storage_path` is empty but `content_id` is set):

| Step | Table | Columns / filters |
|------|-------|-------------------|
| Track audio via link | `release_media` | `media_assets(storage_path, bucket)`, `track_id`, `is_active`, `asset_role` in full-audio roles |
| Track audio direct | `media_assets` | `storage_path, bucket`, `owner_type = 'track'`, `owner_id = trackId` |
| Release → first track | `tracks` | `id` where `release_id = contentId`, ordered by `position` |

For `hour-glass`, `content_type` and `content_id` are **null** in Supabase, so resolution uses **`products.storage_path` only** (no media graph).

**Normalization:** resolved path → `normalizePlaybackR2Key()` → e.g. `singles/hour-glass/audio.mp3` → `digital-assets/singles/hour-glass/audio.mp3`.

### Return when nothing found (exact code)

| Condition | Return |
|-----------|--------|
| Empty slug | `return null;` (line 75) |
| No product row | `return null;` (line 84) |
| No storage path after resolution | `return null;` (line 88) |
| Normalization yields empty key | `return null;` (line 91) |
| Supabase query error | `throw error;` (line 83) — **500 path** |

Success: `return { key, source };` (lines 93–96).

---

## 2. `src/lib/playback/stream-pipeline.js`

### `resolveProductIdBySlug`

```js
export async function resolveProductIdBySlug(admin, slug) {
  const { data, error } = await admin.from("products").select("id").eq("slug", slug).maybeSingle();
  if (error) throw error;
  return data?.id || null;
}
```

| Item | Value |
|------|-------|
| Table | `products` |
| Match column | `slug` |
| Select | `id` |
| Product not found | `return data?.id || null` → **`null`** (caller returns 404) |
| Query error | **`throw error`** → 500 |

### `stream_sessions` helpers

- `findActiveStreamSession`, `createStreamSession`, `insertStreamEvent`: if table missing (`42P01`), return `null` gracefully.
- If table **exists** and insert/select fails → **throw** → 500.

---

## 3. `src/lib/storage/r2.js`

### `createR2SignedGetUrl` behavior

```js
export async function createR2SignedGetUrl(key, expiresIn = 3600) {
  const command = new GetObjectCommand({ Bucket: R2_BUCKET, Key: key });
  return getSignedUrl(r2Client, command, { expiresIn });
}
```

- Builds `GetObjectCommand` with `Bucket: R2_BUCKET` and caller-supplied `Key`.
- Returns presigned URL string via `@aws-sdk/s3-request-presigner`.
- **No validation** of `key`, bucket, or credentials before signing.

### Environment variables used

| Variable | Usage |
|----------|---------|
| `CLOUDFLARE_R2_ENDPOINT` | `S3Client` endpoint (module init) |
| `CLOUDFLARE_R2_ACCESS_KEY_ID` | Client credentials |
| `CLOUDFLARE_R2_SECRET_ACCESS_KEY` | Client credentials |
| `CLOUDFLARE_R2_BUCKET_NAME` | `R2_BUCKET` constant; bucket in signed GET |

Related (not in `createR2SignedGetUrl` itself): `NEXT_PUBLIC_R2_PUBLIC_URL` used by `getPublicR2Url`.

Route debug flag: `R2_STREAM_DEBUG=1` logs env **presence only** (not values).

### Does it throw if env missing?

**No explicit throw in this function.** Module-level `S3Client` is constructed even when env vars are `undefined`. Signing typically **throws at runtime** from the AWS SDK (e.g. credential/endpoint errors). Contrast: `checkR2Connectivity()` returns `{ ok: false, message: "R2 env not configured" }` without throwing — but the stream route does **not** call it.

---

## 4. Supabase schema (MCP `plugin-supabase-supabase`)

**Project:** `qvfbgkbgczyqrglvgyqr` (`2MRRW-Frontend Project`)

### Table existence

| Table | Exists |
|-------|--------|
| `products` | Yes |
| `stream_sessions` | Yes |
| `stream_events` | Yes |
| `tracks` | Yes |
| `release_media` | **No** |
| `media_assets` | **No** |

### `products` — relevant columns

| Column | Type | Notes |
|--------|------|-------|
| `slug` | text NOT NULL UNIQUE | Lookup key |
| `storage_path` | text nullable | Primary playback path for commerce rows |
| `content_type` | text nullable | Used when `storage_path` empty |
| `content_id` | uuid nullable | Track/release FK for media graph |
| `preview_path` | text nullable | Not used by stream route |

**Absent columns:** `audio_key`, `file_key`, and any dedicated R2 path column. R2 key is derived from `storage_path` (+ optional media graph).

### `hour-glass` row (live query)

| slug | storage_path | content_type | content_id | product_type | active |
|------|--------------|--------------|------------|--------------|--------|
| `hour-glass` | `singles/hour-glass/audio.mp3` | null | null | single | true |

No `hour-glass-digital` row in this project.

### `stream_sessions` columns

| Column | Type |
|--------|------|
| `session_id` | uuid PK |
| `user_id` | uuid FK → auth.users |
| `product_id` | uuid FK → products |
| `started_at` | timestamptz |
| `expires_at` | timestamptz |

### `stream_events` columns

| Column | Type |
|--------|------|
| `id` | uuid PK |
| `user_id` | uuid |
| `product_id` | uuid |
| `started_at` | timestamptz |
| `ended_at` | timestamptz nullable |
| `duration_seconds` | integer nullable |
| `completed` | boolean |
| `created_at` | timestamptz |

---

## 5. `src/app/api/library/stream/route.js` — GET error logging

### Current catch block (exact — no stack trace)

```js
  try {
    logStreamR2Env("get");
    return await buildStreamResponse(req, user, slug, { force });
  } catch (err) {
    logStreamR2Env("get_error");
    console.error("[library/stream] GET failed", { slug, userId: user.id, err: err?.message });
    return NextResponse.json({ error: "Stream unavailable" }, { status: 500 });
  }
```

**Does it log full stack trace?** **No.** Only `err?.message` in a structured object. No `err.stack`, no second argument to `console.error`.

DELETE catch (same pattern):

```js
  } catch (err) {
    console.error("[library/stream] DELETE failed", { slug, userId: user.id, err: err?.message });
    return NextResponse.json({ error: "Could not clear session" }, { status: 500 });
  }
```

There is **no** inner try/catch around `buildStreamResponse`; all thrown errors surface to the GET catch above.

---

## 6. `buildStreamResponse` flow and 500 paths

```
GET /api/library/stream?slug=hour-glass
  ├─ 400  slug missing
  ├─ 401  no user (getFanSessionUser ?? getGuestUser)
  └─ try buildStreamResponse
       ├─ validateStreamEntitlement → 403 or throw (DB)
       ├─ createAdminClient() → throw if Supabase env missing
       ├─ resolveProductIdBySlug → 404 or throw
       ├─ findActiveStreamSession → 409 or throw
       ├─ resolvePlaybackKey → 404 (no key) or throw (query error)
       ├─ createStreamSession → null OK or throw
       ├─ insertStreamEvent → null OK or throw
       ├─ getOrCreateStreamSignedUrl → createR2SignedGetUrl → throw on sign failure
       └─ 200 JSON { url, expiresIn, sessionId, streamEventId } or 302 redirect
  catch → 500 { error: "Stream unavailable" }
```

### hour-glass-specific notes

- Resolved R2 key (expected): `digital-assets/singles/hour-glass/audio.mp3` (per `normalizePlaybackR2Key`).
- Prior R2 audit (`docs/reports/r2-playback-fix-20260525.md`) confirmed presigned GET **206** for that object when credentials are configured.
- UI/catalog uses slug `hour-glass`; some E2E docs still reference deprecated `hour-glass-digital` (no DB row).

---

## 7. Recommended investigation order (no code changes)

1. Reproduce with entitled session; capture server log line `[library/stream] GET failed` — message only, no stack today.
2. Set `R2_STREAM_DEBUG=1` and confirm all four `CLOUDFLARE_R2_*` booleans are true in the failing environment.
3. Verify `SUPABASE_SERVICE_ROLE_KEY` and `NEXT_PUBLIC_SUPABASE_URL` on the deployment serving the 500.
4. If message implicates DB, check Supabase logs for failed `stream_sessions` / `stream_events` inserts or entitlement queries for the requesting `user_id`.
5. Optionally enable temporary stack logging in a **future** fix pass (out of scope for this read-only audit).

---

## Files read

See `manifest.txt` in the accompanying zip.
