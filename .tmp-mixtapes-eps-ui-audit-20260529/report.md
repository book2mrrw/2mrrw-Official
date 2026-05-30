# Mixtapes & EPs UI audit — 2026-05-29

**Repo:** `/Users/recharge/artist-platform`  
**Commit:** `9b25e069b4bd7e12cf6857c2a489e810932970ef`  
**Mode:** Read-only audit (Part 1 complete; Part 2 not implemented)  
**Output:** `.tmp-mixtapes-eps-ui-audit-20260529/`

---

## Executive summary

Backend canonical work for **mixtapes-and-eps** (paths, `trackSlug` streaming, canonical track slugs/titles) is in place. The **storefront and My Music Tab UI do not match the prompt**: there is no **Mixtapes & EPs** section, no Singles-style cards for those releases, and My Music still only shows **Owned Singles** and **Owned Albums**. All three releases (**love-hz-vol-1**, **ad**, **tbh**) appear under **Albums** via `CatalogGrid` with stale inline tracklists and legacy artwork paths.

---

## Prompt requirements (from `cursor-mixtapes-eps-ui-audit.md`)

### Part 1 — Audit (this deliverable)

- Storefront section inventory → `part1-storefront-and-mymusic.md`
- Singles reference UI → Home **Latest Singles** row (160/200px video cards); Music tab uses different `CarouselUI`
- My Music categories → documented; **Mixtapes** / **EPs** missing
- Release type mapping → `release-types.js`, `canonical-catalog.js`, inline `page.js` albums

### Part 2 — Implement

See `part2-implementation-gap.md` — **not executed** this session.

---

## Key findings

1. **No dedicated Mixtapes & EPs storefront section** — `love-hz-vol-1`, `ad`, and `tbh` render in **Albums** (`CatalogGrid`), not under a Singles-cloned row.
2. **UI ≠ Singles pipeline** — Albums use image cards + `AlbumModal`; Singles use video cards + `ImmersivePreviewModal` single flow.
3. **Tracklists diverge from canonical** — Inline `tracks: ["Glass Full", …]` vs `CANONICAL_TRACKS` slugs (`01-glass-full`, …); wrong counts and titles for all three releases.
4. **Slug drift on Love Hz** — Inline `love-hz` vs canonical `love-hz-vol-1` (alias helps metadata merge, risky for commerce slug).
5. **Stream contract is correct** when canonical slugs used: `/api/library/stream?slug={releaseSlug}&trackSlug={trackSlug}`.
6. **My Music** buckets EP/mixtape ownership into **Owned Albums**; no **Mixtapes** or **EPs** categories.
7. **`getStorefrontAlbums()` exists** but `page.js` does not consume it — storefront data is static `INLINE_ALBUMS`.
8. **Label "Albums & EPs"** already renamed to **Albums** in UI; remaining gap is split + new section.

---

## Per-release detail

Full matrices: `releases-love-hz-ad-tbh.md`

---

## Files read / changed

| | |
|-|-|
| **Read** | `files-read.txt`, `manifest.txt` |
| **Changed** | None |
| **Build** | Not run (no code changes) |
| **Commit** | None |

---

## Zip

Packaged for delivery: `/Users/recharge/Downloads/mixtapes-eps-ui-audit-20260529.zip`
