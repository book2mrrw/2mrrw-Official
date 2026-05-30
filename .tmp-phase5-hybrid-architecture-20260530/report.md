# Phase 5 — Hybrid Master / Stream Architecture Design

**Date:** 2026-05-30  
**Repo:** `/Users/recharge/artist-platform`  
**Mode:** Design only — **zero source modifications**  
**Inputs:** Phase 4.5–4.8 audits, playback instrumentation, prior zips in `~/Downloads`  
**Zip:** `/Users/recharge/Downloads/phase5-hybrid-architecture-20260530.zip`

---

## Executive summary

2MRRW today uses **one physical asset class** for both archival ownership and in-browser playback: lossless or large masters (WAV/FLAC, sometimes MP3) discovered in R2 entity folders under `digital-assets/`, served to entitled fans through a same-origin signed proxy (`/api/library/stream?redirect=1`). Previews are a **separate** public-CDN layer under `previews/`. Phases 4.5–4.8 proved the **client fast path is sound**; remaining tap→audible delay is dominated by **server resolution**, **preview API hops**, and **CDN first-byte** on large master objects (~954 ms TTFB measured for 64 KiB range on preview CDN).

Phase 5 recommends a **hybrid architecture**: **masters stay masters** (WAV/FLAC/AIFF, collector-grade, download authority), while a **dedicated streaming renditions layer** (AAC-LC 128–192 kbps + optional HLS) lives beside them, keyed by the same entity-folder identity. Playback resolution prefers stream renditions; purchase/collector/download flows continue to reference master keys and existing entitlement tables.

This is a **non-destructive, phased** evolution: upload masters as today, generate stream files asynchronously, dual-read in `resolvePlaybackKey`, CDN-cache public stream segments where policy allows, keep `redirect=1` proxy for entitled Range requests until CDN signed-access is validated.

---

## Final recommendation (one-liner)

**Split archival masters from playback renditions in R2 (same entity folder, new `stream/` sibling keys), resolve stream keys first in `resolvePlaybackKey`, keep masters for collector/download authority, and roll out via parallel upload + feature-flagged resolver — no entitlement or UI changes in Phase 5.**

---

## Evidence vs projection

| Finding | Type | Source |
|---------|------|--------|
| CDN preview first-byte ~954 ms (64 KiB range) | **Measured** | Phase 4.7 `02-measured-latency-table.md`, `curl-measurements.txt` |
| Preview API TTFB 602 ms → ~4 ms warm (4.8) | **Measured** (prod / local warm) | Phase 4.8 `report.md` |
| Stream redirect 401 TTFB 279–804 ms prod; ~3–9 ms warm local | **Measured** | Phase 4.7–4.8 |
| Master discovery prefers `.wav` before `.mp3` | **Code** | `src/lib/media/entity-resolver.js` L16 |
| Entitled client uses `redirect=1`, no JSON+HEAD on tap | **Code** | `src/lib/music-access.js`, `AudioContext.js` |
| Tap→audible p50 300–1200 ms entitled | **Projection** | Phase 4.5 `03-audio-start-latency.md` |
| Stream rendition −40–70% first-byte vs WAV | **Projection** | Industry AAC vs PCM; requires HAR after rollout |
| HLS startup −200–500 ms mobile Safari | **Projection** | Platform guidance; requires device validation |

---

## Architecture decision record

| Option | Verdict | Rationale |
|--------|---------|-----------|
| Transcode on every play | **Reject** | Violates latency budget; duplicates 4.7–4.8 wins |
| Replace masters with MP3 only | **Reject** | Breaks collector/download brand promise |
| Hybrid master + stream renditions | **Adopt** | Preserves ownership artifact; fixes byte-weight startup |
| Move all audio to public CDN | **Defer** | Entitlement must stay server-gated; proxy remains |
| Supabase Storage migration (platform rule) | **Future** | Out of Phase 5 scope; design compatible |

---

## Deliverables index

See `manifest.txt`. Deep dives: `01`–`11`.

---

## Phase 4.x carry-forward (locked)

Per Phase 4.8 architecture lock — **do not regress**:

- Single `<audio>` element, `AudioContext` command queue
- Entitlements: webhook → Supabase → `/api/account/state` → UI
- `redirect=1` entitled path; preview CDN for guests
- Server-Timing, playback key cache, stream URL cache, preview fast path (implemented 4.8)

Phase 5 adds **asset topology and resolver precedence** only in design; implementation is a later phase.

---

## Next implementation phase (out of scope here)

1. R2 key convention + ingest job spec (`stream/{releaseType}/…`)
2. `resolvePlaybackKey` stream-first with master fallback
3. Backfill transcoding queue for catalog entity folders
4. Prod validation: entitled 200 stream + `Server-Timing` + iOS `dumpPlaybackTiming()`
