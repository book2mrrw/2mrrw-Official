# Recommended fixes — Phase 5.3.3A (documentation only)

No code or R2 changes in this phase. Pick **one primary strategy per track** before re-running backfill.

## Fix category counts

| Category | Description | Tracks |
|----------|-------------|-------:|
| **A** | R2 folder rename → canonical DB slug | 6 |
| **B** | DB `storage_path` / slug update → match R2 | 0–6 (alternative to A) |
| **C** | love-hz EP renumber + missing track 1 | 4 (01 + 07–09) |
| **D** | Resolver alias / fuzzy folder map (code) | 9 (optional hardening) |
| **E** | Upload missing master | 1 |

**Primary ops path:** **A + C + E** = 9 tracks with existing audio; **1** upload.

---

## Category A — R2 rename to canonical slug (preferred)

| Track | From (R2 folder) | To (canonical) |
|-------|------------------|----------------|
| ad/03-said-n-done | `03-said-n-done ` | `03-said-n-done` |
| ad/04-a-d-d | `04-a.d.d` | `04-a-d-d` |
| ad/08-life-changes-ft-gwendolyn | `08-life-changes ft. gwendolyn` | `08-life-changes-ft-gwendolyn` |
| love-hz-vol-1/02-w-2-d | `02-w2d` | `02-w-2-d` |
| tbh/03-unxpcted | `03-unxpected` | `03-unxpcted` |
| tbh/08-2late | `08-2late?` | `08-2late` |

**Ops notes:** Use R2 copy+delete or migration tooling; preserve flat-file layout (no `audio/` subfolder). Verify non-recursive discovery after rename with `node scripts/verify-r2-entity-folders.mjs`.

---

## Category C — love-hz-vol-1 track number realignment

Execute **after** resolving `01-roll-call` (Category E).

| DB track | Current R2 folder with audio | Action |
|----------|------------------------------|--------|
| 07-stayed-2-long | `09-stayed-2-long` | Move → `07-stayed-2-long` |
| 08-knock-on-wood | `07-knock-on-wood` | Move → `08-knock-on-wood` |
| 09-hour-glass | `08-hour-glass` | Move → `09-hour-glass` |

**Root cause hypothesis:** Track 1 never uploaded; uploader used alternate numbering for late EP tracks. Full EP folder audit recommended before force backfill.

---

## Category E — Upload missing master

| Track | Action |
|-------|--------|
| love-hz-vol-1/01-roll-call | Upload WAV/FLAC/MP3 to `digital-assets/mixtapes-and-eps/love-hz-vol-1/01-roll-call/` |

---

## Category B — DB alignment (alternative to A)

Use only when R2 rename is blocked (CDN links, external references).

- Update `catalog_tracks.storage_path` to match **actual** R2 folder string.
- Risk: UI slugs, preview paths, and stream keys remain on canonical slugs — prefer R2 alignment.

---

## Category D — Code hardening (future implementation)

Optional migration-window mitigations in `entity-resolver.js` / `resolveMasterR2Key`:

1. **Trim/normalize folder segments** — collapse trailing spaces on list prefix.
2. **Alias table** — `04-a-d-d` → `04-a.d.d`, `03-unxpcted` → `03-unxpected`, etc.
3. **Sibling folder scan** — same album, fuzzy match on slug stem (high risk; last resort).
4. **Do not** enable recursive nested `audio/` discovery without explicit scope (regresses 2026-05-28 flat-folder contract).

---

## Verification checklist (post-fix)

1. `resolveAudioFile(normalizeStoragePathForStorefront(storage_path))` returns non-null for all 10.
2. `npm run backfill:stream-assets -- --yes --force --album-slug <album> --slug <track>` per track (or full catalog).
3. `scripts/phase533-full-catalog-validation.mjs` — 36/36 registered streams.
4. Playback smoke: `/api/library/stream?slug=…&trackSlug=…` for each repaired track.

---

## Phase 5.3.3 report correction

Update future inventory docs to distinguish:

- **`master_not_found` (lookup)** — asset exists, folder key mismatch.
- **`master_absent` (content)** — no object under canonical or reasonable alias prefix.

This audit reclassifies **9 lookup**, **1 absent**.
