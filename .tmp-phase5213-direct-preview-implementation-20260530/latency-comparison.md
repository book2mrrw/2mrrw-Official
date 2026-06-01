# Latency Comparison — Phase 5.2.13

**Sources:** Phase 5.2.10 curl probes, Phase 5.2.11 `latency-model.md`  
**Representative asset:** `hourglass-preview.mp3` / canonical `previews/singles/hour-glass/hourglass-preview.mp3`

---

## Removed segments (flag ON, eligible preview)

| Segment | Best (ms) | Expected (ms) | Worst (ms) |
|---------|-----------|---------------|------------|
| Preview API TTFB | 141 | 141 | 391 |
| Browser redirect follow | 198 | 198 | 198 |
| **Combined overhead removed** | **~339** | **~339** | **~589** |

CDN TTFB (~115–210 ms) and ID3 parse (~15–55 ms) **unchanged** — same object, one fewer hop.

---

## Tap → CDN first byte

| Case | Current (API + 302) | Direct CDN (5.2.13 ON) | **Saved** |
|------|---------------------|-------------------------|-----------|
| **Best** | ~335 | ~115 | **~220** |
| **Expected** | ~470 | ~130 | **~340** |
| **Worst** | ~800 | ~360 | **~440** |

---

## Tap → metadata-ready (approximate)

| Case | Current | Direct | **Saved** |
|------|---------|--------|-----------|
| **Best** | ~474 | ~135 | **~340** |
| **Expected** | ~504 | ~165 | **~340** |
| **Worst** | ~1004 | ~415 | **~590** |

---

## Planning figures

| Metric | Value |
|--------|-------|
| Conservative (API TTFB only) | **140–390 ms** |
| Expected tap→audible improvement | **~250–340 ms** |
| Preconnect bonus (unchanged CDN) | +40–150 ms when hints run first |

---

## Not in scope

- Entitled `/api/library/stream` path
- Full MP3 download latency
- Hybrid stream resolver (Phase 5.2 flags remain OFF)
