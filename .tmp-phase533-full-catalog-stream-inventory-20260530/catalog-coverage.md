# Catalog Coverage — Phase 5.3.3

**Scope:** Playable catalog only (singles, features, mixtapes, EPs, multi-track, catalog tracks, legacy playable).  
**Excluded:** Collector-only downloads, vault-only preservation, non-playable archival.

---

## Summary

| Category | Total | Stream registered | Coverage |
|----------|-------|-------------------|----------|
| Singles / features (products) | 6 | 6 | **100%** |
| Mixtape/EP tracks (`ad`) | 11 | 8 | **72.7%** |
| Mixtape/EP tracks (`love-hz-vol-1`) | 10 | 5 | **50%** |
| Mixtape/EP tracks (`tbh`) | 9 | 7 | **77.8%** |
| **Total playable assets** | **36** | **26** | **72.2%** |

---

## Release inventory

### Singles & features (6/6 — 100%)

| Slug | Title | Type | Stream |
|------|-------|------|--------|
| `hour-glass` | Hour Glass | single | ✅ |
| `artificial` | ArTiFiCiAL | single | ✅ |
| `turnt-me-2-dis` | Turnt Me 2 Dis | single | ✅ |
| `w2d` | W.2.D | single | ✅ |
| `2-heavy` | 2 Heavy | feature | ✅ |
| `i-dont-believe-you` | I Don't Believe You | feature | ✅ |

### Mixtape: `ad` (8/11 — 72.7%)

| Track | Stream |
|-------|--------|
| `01-2mrrws-ntro` | ✅ |
| `02-here-i-come` | ✅ |
| `03-said-n-done` | ❌ master_not_found |
| `04-a-d-d` | ❌ master_not_found |
| `05-perspective` | ✅ |
| `06-grand-scheme` | ✅ |
| `07-a2b` | ✅ |
| `08-life-changes-ft-gwendolyn` | ❌ master_not_found |
| `09-itself` | ✅ |
| `10-wastin-time` | ✅ |
| `11-like-me-or-not` | ✅ |

### EP: `love-hz-vol-1` (5/10 — 50%)

| Track | Stream |
|-------|--------|
| `01-roll-call` | ❌ master_not_found |
| `02-w-2-d` | ❌ master_not_found |
| `03-guarded-heart` | ✅ |
| `04-all-love-it` | ✅ |
| `05-like-u-do` | ✅ |
| `06-tell-me` | ✅ |
| `07-stayed-2-long` | ❌ master_not_found |
| `08-knock-on-wood` | ❌ master_not_found |
| `09-hour-glass` | ❌ master_not_found |
| `10-turnt-me-2-dis` | ✅ |

### Mixtape: `tbh` (7/9 — 77.8%)

| Track | Stream |
|-------|--------|
| `01-glass-full` | ✅ |
| `02-up-2-me` | ✅ |
| `03-unxpcted` | ❌ master_not_found |
| `04-all-yours` | ✅ |
| `05-locomotive` | ✅ |
| `06-left` | ✅ |
| `07-was-wrong` | ✅ |
| `08-2late` | ❌ master_not_found |
| `09-artificial` | ✅ |

---

## Coverage gap root cause

All 10 uncovered tracks share one failure mode: **`master_not_found`** — no resolvable WAV/FLAC master in R2 at the expected `digital-assets/` path derived from `storage_path`. These are content ops blockers, not pipeline defects.
