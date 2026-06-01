# Registration Audit — Phase 5.3.1

**Run date:** 2026-05-31  
**Section result:** **PASS** (8/8 backfilled rows fully registered)

---

## Schema columns (migration applied)

| Table | Columns | Status |
|-------|---------|--------|
| `products` | `stream_path`, `stream_key` | ✅ Exist, populated for 6/6 products |
| `catalog_tracks` | `stream_path`, `stream_key` | ✅ Exist, populated for 2/30 tracks |

---

## Product registrations

| slug | stream_path | stream_key | Registered |
|------|-------------|------------|------------|
| hour-glass | `streaming/singles/hour-glass/` | `streaming/singles/hour-glass/hour-glass_192.m4a` | ✅ |
| 2-heavy | `streaming/features/2-heavy/` | `streaming/features/2-heavy/2-heavy_192.m4a` | ✅ |
| artificial | `streaming/singles/artificial/` | `streaming/singles/artificial/artificial_192.m4a` | ✅ |
| i-dont-believe-you | `streaming/features/i-dont-believe-you/` | `streaming/features/i-dont-believe-you/i-dont-believe-you_192.m4a` | ✅ |
| turnt-me-2-dis | `streaming/singles/turnt-me-2-dis/` | `streaming/singles/turnt-me-2-dis/turnt-me-2-dis_192.m4a` | ✅ |
| w2d | `streaming/singles/w2d/` | `streaming/singles/w2d/w2d_192.m4a` | ✅ |

Metadata patch also includes `stream_format`, `stream_quality`, `stream_generated_at` on product rows.

---

## Catalog track registrations

| album_slug | slug | stream_path | stream_key | Registered |
|------------|------|-------------|------------|------------|
| ad | 01-2mrrws-ntro | `streaming/mixtapes-and-eps/ad/01-2mrrws-ntro/` | `…/01-2mrrws-ntro_192.m4a` | ✅ |
| tbh | 01-glass-full | `streaming/mixtapes-and-eps/tbh/01-glass-full/` | `…/01-glass-full_192.m4a` | ✅ |

---

## Unregistered catalog (expected — canary scope)

- **Products:** 0 remaining (all 6 backfilled)
- **Tracks:** 28 remaining without `stream_key`
- **Failed candidate:** `love-hz-vol-1/01-roll-call` — no stream registration (master missing)

---

## Validation method

`scripts/phase531-canary-validation.mjs` — Supabase service-role SELECT on canary slugs.

**Registration miss rate (canary):** 0 / 8 successful backfills.
