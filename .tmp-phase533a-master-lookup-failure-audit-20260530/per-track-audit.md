# Per-track master lookup audit (10 tracks)

Probe: live R2 ListObjectsV2 + `resolveAudioFile(normalizeStoragePathForStorefront(storage_path))`  
Titles from Phase 5.3.3 validation / canonical migration.

---

## 1. ad / 03-said-n-done — Said N' Done

| Field | Value |
|-------|-------|
| Release slug | `ad` |
| Track slug | `03-said-n-done` |
| Track title | Said N' Done |

**Backfill lookup trace**

| Item | Value |
|------|-------|
| DB `storage_path` | `mixtapes-and-eps/ad/03-said-n-done/` |
| Normalized prefix | `digital-assets/mixtapes-and-eps/ad/03-said-n-done/` |
| Code path | `backfill-stream-assets.mjs` → `generateStreamAssetForCatalogTrack` → `resolveMasterR2Key` → `resolveAudioFile` → `discoverFileByExtensions` (non-recursive) |
| Requested discovery folder | `digital-assets/mixtapes-and-eps/ad/03-said-n-done/` |
| Resolved master key | `null` → `master_not_found` |

**R2 comparison**

| Item | Value |
|------|-------|
| Actual object key | `digital-assets/mixtapes-and-eps/ad/03-said-n-done /Said N' Done (A.D).wav` |
| Actual folder | `03-said-n-done ` (**trailing space** before `/`) |
| Filename | `Said N' Done (A.D).wav` |

**Mismatch analysis:** R2 folder slug includes a trailing space; S3/R2 prefix listing for canonical slug does not include objects under the spaced variant. Discovery is exact-prefix only.

**Recommended fix:** Rename R2 prefix to `03-said-n-done/` (remove trailing space) **or** update DB `storage_path` to match spaced folder (less desirable). Category **A**.

---

## 2. ad / 04-a-d-d — A.D.D

| Field | Value |
|-------|-------|
| Release slug | `ad` |
| Track slug | `04-a-d-d` |
| Track title | A.D.D |

**Backfill lookup trace**

| Item | Value |
|------|-------|
| DB `storage_path` | `mixtapes-and-eps/ad/04-a-d-d/` |
| Normalized prefix | `digital-assets/mixtapes-and-eps/ad/04-a-d-d/` |
| Resolved master key | `null` |

**R2 comparison**

| Item | Value |
|------|-------|
| Actual object key | `digital-assets/mixtapes-and-eps/ad/04-a.d.d/A.D.D.wav` |
| Actual folder | `04-a.d.d` |
| Filename | `A.D.D.wav` |

**Mismatch analysis:** R2 uses dotted segment `a.d.d`; DB/canonical slug uses hyphens `a-d-d`. No object under expected prefix.

**Recommended fix:** Rename folder `04-a.d.d` → `04-a-d-d`. Category **A**.

---

## 3. ad / 08-life-changes-ft-gwendolyn — Life Changes ft. Gwendolyn

| Field | Value |
|-------|-------|
| Release slug | `ad` |
| Track slug | `08-life-changes-ft-gwendolyn` |
| Track title | Life Changes ft. Gwendolyn |

**Backfill lookup trace**

| Item | Value |
|------|-------|
| DB `storage_path` | `mixtapes-and-eps/ad/08-life-changes-ft-gwendolyn/` |
| Normalized prefix | `digital-assets/mixtapes-and-eps/ad/08-life-changes-ft-gwendolyn/` |
| Resolved master key | `null` |

**R2 comparison**

| Item | Value |
|------|-------|
| Actual object key | `digital-assets/mixtapes-and-eps/ad/08-life-changes ft. gwendolyn/Life Changes ft. Gwendolyn.mp3` |
| Actual folder | `08-life-changes ft. gwendolyn` (spaces, no `-ft-` kebab) |
| Filename | `Life Changes ft. Gwendolyn.mp3` |

**Mismatch analysis:** R2 folder uses human-readable spacing; DB uses URL-safe kebab slug with `-ft-gwendolyn`.

**Recommended fix:** Rename R2 folder to `08-life-changes-ft-gwendolyn/`. Category **A**.

---

## 4. love-hz-vol-1 / 01-roll-call — Roll Call

| Field | Value |
|-------|-------|
| Release slug | `love-hz-vol-1` |
| Track slug | `01-roll-call` |
| Track title | Roll Call |

**Backfill lookup trace**

| Item | Value |
|------|-------|
| DB `storage_path` | `mixtapes-and-eps/love-hz-vol-1/01-roll-call/` |
| Normalized prefix | `digital-assets/mixtapes-and-eps/love-hz-vol-1/01-roll-call/` |
| Resolved master key | `null` |

**R2 comparison**

| Item | Value |
|------|-------|
| Actual object key | *(none)* |
| `love-hz-vol-1` audio folders (live) | `02-w2d`, `03-guarded-heart`, … `10-turnt-me-2-dis` — **no `01-*` folder** |
| Broad search `roll-call` under `digital-assets/` | No hits |

**Mismatch analysis:** Master is **genuinely absent** at canonical and alias paths. Consistent with `.tmp-final-playback-validation-20260528` empty-folder finding. Not a resolver bug.

**Recommended fix:** Upload master to `digital-assets/mixtapes-and-eps/love-hz-vol-1/01-roll-call/`; then re-backfill. Category **E**. Consider renumbering downstream R2 folders if track 1 was skipped during bulk upload (see tracks 6–8).

---

## 5. love-hz-vol-1 / 02-w-2-d — W.2.D

| Field | Value |
|-------|-------|
| Release slug | `love-hz-vol-1` |
| Track slug | `02-w-2-d` |
| Track title | W.2.D |

**Backfill lookup trace**

| Item | Value |
|------|-------|
| DB `storage_path` | `mixtapes-and-eps/love-hz-vol-1/02-w-2-d/` |
| Normalized prefix | `digital-assets/mixtapes-and-eps/love-hz-vol-1/02-w-2-d/` |
| Resolved master key | `null` |

**R2 comparison**

| Item | Value |
|------|-------|
| Actual object key | `digital-assets/mixtapes-and-eps/love-hz-vol-1/02-w2d/W.2.D x 3.wav` |
| Actual folder | `02-w2d` |
| Related (not used) | `digital-assets/singles/w2d/audio.mp3` (single stream already backfilled) |

**Mismatch analysis:** EP track folder uses compact slug `w2d`; DB expects `w-2-d`. Backfill does not fall back to singles path.

**Recommended fix:** Rename `02-w2d` → `02-w-2-d` on R2 **or** point `catalog_tracks.storage_path` at `02-w2d` (weaker). Category **A** (+ note single duplicate).

---

## 6. love-hz-vol-1 / 07-stayed-2-long — Stayed 2 Long

| Field | Value |
|-------|-------|
| Release slug | `love-hz-vol-1` |
| Track slug | `07-stayed-2-long` |
| Track title | Stayed 2 Long |

**Backfill lookup trace**

| Item | Value |
|------|-------|
| DB `storage_path` | `mixtapes-and-eps/love-hz-vol-1/07-stayed-2-long/` |
| Normalized prefix | `digital-assets/mixtapes-and-eps/love-hz-vol-1/07-stayed-2-long/` |
| Resolved master key | `null` |

**R2 comparison**

| Item | Value |
|------|-------|
| Actual object key | `digital-assets/mixtapes-and-eps/love-hz-vol-1/09-stayed-2-long/Stayed 2 Long x 2mrrw (Rough Final).wav` |
| Actual folder | `09-stayed-2-long` |
| Filename | `Stayed 2 Long x 2mrrw (Rough Final).wav` |

**Mismatch analysis:** Audio lives under track **09** prefix; DB catalog assigns **07**. Likely cascade from missing `01-roll-call` folder and manual numbering on upload.

**Recommended fix:** Move/rename R2 folder to `07-stayed-2-long/` **and** audit full EP numeric alignment. Category **C**.

---

## 7. love-hz-vol-1 / 08-knock-on-wood — Knock On Wood

| Field | Value |
|-------|-------|
| Release slug | `love-hz-vol-1` |
| Track slug | `08-knock-on-wood` |
| Track title | Knock On Wood |

**Backfill lookup trace**

| Item | Value |
|------|-------|
| DB `storage_path` | `mixtapes-and-eps/love-hz-vol-1/08-knock-on-wood/` |
| Resolved master key | `null` |

**R2 comparison**

| Item | Value |
|------|-------|
| Actual object key | `digital-assets/mixtapes-and-eps/love-hz-vol-1/07-knock-on-wood/Knock On Wood (EXP) .wav` |
| Actual folder | `07-knock-on-wood` |

**Mismatch analysis:** Off-by-one track number on R2 (−1 vs DB).

**Recommended fix:** Rename/move to `08-knock-on-wood/`. Category **C**.

---

## 8. love-hz-vol-1 / 09-hour-glass — Hour Glass

| Field | Value |
|-------|-------|
| Release slug | `love-hz-vol-1` |
| Track slug | `09-hour-glass` |
| Track title | Hour Glass |

**Backfill lookup trace**

| Item | Value |
|------|-------|
| DB `storage_path` | `mixtapes-and-eps/love-hz-vol-1/09-hour-glass/` |
| Resolved master key | `null` |

**R2 comparison**

| Item | Value |
|------|-------|
| Actual object key | `digital-assets/mixtapes-and-eps/love-hz-vol-1/08-hour-glass/Hour Glass (EVEN).wav` |
| Actual folder | `08-hour-glass` |
| Related | Single `digital-assets/singles/hour-glass/audio.mp3` (separate product; stream exists) |

**Mismatch analysis:** EP copy under `08-hour-glass`; DB expects `09-hour-glass`. Off-by-one numbering.

**Recommended fix:** Rename/move to `09-hour-glass/`. Category **C**.

---

## 9. tbh / 03-unxpcted — Unxpcted

| Field | Value |
|-------|-------|
| Release slug | `tbh` |
| Track slug | `03-unxpcted` |
| Track title | Unxpcted |

**Backfill lookup trace**

| Item | Value |
|------|-------|
| DB `storage_path` | `mixtapes-and-eps/tbh/03-unxpcted/` |
| Resolved master key | `null` |

**R2 comparison**

| Item | Value |
|------|-------|
| Actual object key | `digital-assets/mixtapes-and-eps/tbh/03-unxpected/Unxpected.wav` |
| Actual folder | `03-unxpected` (spelling **unxpected**) |

**Mismatch analysis:** Canonical DB slug `unxpcted` (intentional artist spelling) vs R2 folder `unxpected`.

**Recommended fix:** Rename R2 `03-unxpected` → `03-unxpcted` **or** update DB slug/storage_path to match R2 (only if product/UI should change). Category **A**.

---

## 10. tbh / 08-2late — 2Late?

| Field | Value |
|-------|-------|
| Release slug | `tbh` |
| Track slug | `08-2late` |
| Track title | 2Late? |

**Backfill lookup trace**

| Item | Value |
|------|-------|
| DB `storage_path` | `mixtapes-and-eps/tbh/08-2late/` |
| Resolved master key | `null` |

**R2 comparison**

| Item | Value |
|------|-------|
| Actual object keys | `digital-assets/mixtapes-and-eps/tbh/08-2late?/2Late? (T.B.H).mp3`, `…/2Late?(T.B.H).wav`, `…/2Late?.mp3.mp3` |
| Actual folder | `08-2late?` (**`?` in prefix**) |

**Mismatch analysis:** R2 folder includes `?`; DB slug `08-2late` omits it. Prefix probe for `08-2late/` returns empty.

**Recommended fix:** Rename folder to `08-2late/` (dedupe redundant mp3 variants during ops). Category **A**.
