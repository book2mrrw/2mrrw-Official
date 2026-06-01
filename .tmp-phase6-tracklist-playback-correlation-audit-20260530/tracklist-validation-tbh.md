# Tracklist Validation — `tbh` (T.B.H)

**Release slug:** `tbh`  
**Track count:** 9  
**Storefront section:** Mixtapes & EPs  
**Samples:** Track 1, 3, 5, 7, Last (9)

---

## Code path trace

Identical tracklist → stream stack as other mixtapes. Entitled requests: `/api/library/stream?slug=tbh&trackSlug={track}`.

---

## Per-track audit

### Track 1 — `01-glass-full`

| Stage | Result |
|-------|--------|
| Stream / entitled | **PASS** |
| Guest preview | **PASS** |

### Track 3 — `03-unxpcted` — **was path mismatch (`03-unxpected`)**

| Stage | Result |
|-------|--------|
| Master (post-533B) | `digital-assets/mixtapes-and-eps/tbh/03-unxpcted/Unxpected.wav` |
| Stream | `streaming/mixtapes-and-eps/tbh/03-unxpcted/03-unxpcted_192.m4a` |
| Entitled | **PASS** (was **FAIL**) |
| Guest preview | **PASS** |

### Track 5 — `05-locomotive`

| Stage | Result |
|-------|--------|
| Stream / entitled | **PASS** |
| Guest preview | **PASS** |

### Track 7 — `07-was-wrong`

| Stage | Result |
|-------|--------|
| Stream / entitled | **PASS** |
| Guest preview | **PASS** |

### Track 9 (last) — `09-artificial`

| Stage | Result |
|-------|--------|
| Stream / entitled | **PASS** |
| Guest preview | **PASS** |

---

## Remediated not in sample

| Track | Pre-533B issue | Post-533B |
|-------|----------------|-----------|
| `08-2late` | R2 folder `08-2late?` | **PASS** |

---

## Release-level result

| Audience | Result |
|----------|--------|
| Entitled tracklist (sampled) | **PASS** — 5/5 |
| Guest tracklist (sampled) | **PASS** |
| Correlation | Track 3 (and 8) failures were **directly** path-mismatch related; remediated |
