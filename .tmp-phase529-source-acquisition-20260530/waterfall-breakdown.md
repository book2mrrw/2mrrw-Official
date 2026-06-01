# Phase 5.2.9 — Waterfall: src assignment → loadedmetadata

**Window:** `PLAYBACK_SRC_ASSIGN` → `PLAYBACK_LOADEDMETADATA` (`playback-src-to-loadedmetadata`)  
**Typical cold guest preview:** **80–250 ms** (Phase 5.2.8 baseline)  
**Live curl anchor (2026-05-31):** TTFB **131–195 ms** on canonical nested MP3

---

## Sub-segment model

```
audio.src = url
    │
    ├─[A] Browser schedules media fetch (initiator: audio)
    │      fetchStart
    ├─[B] DNS lookup (skipped if preconnect warmed)
    │      domainLookupStart → domainLookupEnd
    ├─[C] TCP connect
    │      connectStart → connectEnd
    ├─[D] TLS handshake (HTTPS)
    │      secureConnectionStart → connectEnd
    ├─[E] Request on wire
    │      requestStart
    ├─[F] CDN edge + R2 origin → first byte
    │      responseStart  ← TTFB (curl: time_starttransfer)
    ├─[G] First Range/body bytes to media pipeline
    │      responseStart → (enough bytes for probe)
    └─[H] Demux: ID3/MP3 frame sync → HAVE_METADATA
           loadedmetadata event
```

| Segment | Resource Timing / probe | Est. ms (cold preview) | % of 80–250 ms |
|---------|-------------------------|------------------------|----------------|
| A | — | 0–5 | <5% |
| B | `dnsMs` | 0–5 warm; **+15–40** cold mobile | 0–20% |
| C+D | `tcpMs` + `tlsMs` | **11–35** warm (curl); **+40–150** cold w/o preconnect | 15–60% |
| E | `requestDispatchMs` | 0–10 | <5% |
| F | `ttfbMs` / curl `time_starttransfer` | **131–195** | **55–75%** |
| G | `downloadMs` (partial) | 0–30 (1k–64k range) | 0–15% |
| H | mark gap: `srcToMetadata − ttfb` | **15–55** | 10–25% |

---

## Measured curl waterfall (canonical preview MP3)

**URL:** `https://pub-643e4a94e0184b1fabf6522cfbb16f75.r2.dev/previews/singles/hour-glass/hourglass-preview.mp3`

| Step | Probe | dns | connect | tls | ttfb | total |
|------|-------|-----|---------|-----|------|-------|
| HEAD | cold-ish | 1.5 ms | 11.6 ms | 34.6 ms | **132.6 ms** | 132.7 ms |
| GET Range 0–1023 | reuse | 1.4 ms | 11.3 ms | 28.2 ms | **194.7 ms** | 194.9 ms |
| GET Range 0–65535 | reuse | — | — | — | **130.9 ms** | 159.1 ms |

**Interpretation:** TTFB dominates; 64k range adds ~28 ms download after TTFB — browser may request similar byte window before metadata.

---

## Preview path: before src assign (context)

Guest tap often hits API before direct CDN `src`:

| Step | Endpoint | Measured (2026-05-31) |
|------|----------|------------------------|
| 1 | `GET /api/media/preview?folder=previews/singles/hour-glass/` | **302** → nested CDN URL, `x-vercel-cache: MISS` |
| 2 | Follow redirect to R2 | **ttfb 361 ms** (redirect response only) |
| 3 | Full redirect chain `-L` | **total 1.21 s** |

This time is **outside** `playback-src-to-loadedmetadata` but explains tap→src gaps on first play.

---

## Dev waterfall (browser)

After play in `npm run dev`:

```js
const d = window.dumpPlaybackTiming();
d.measures["playback-src-to-loadedmetadata"];
d.sourceAcquisition; // dnsMs, tlsMs, ttfbMs, …
d.sourceAcquisitionAttribution;
```

**Synthetic example** (illustrative):

```
src assign          0 ms
fetchStart         +2 ms
responseStart    +142 ms  ← TTFB
loadedmetadata   +168 ms  ← +26 ms parse/dispatch
```

---

## Scenarios (src→metadata expectation)

| Scenario | Expected ms | Notes |
|----------|-------------|-------|
| Guest preview (cold CDN connection) | **120–250** | API redirect may precede src |
| Guest preview (preconnect warm) | **80–180** | Saves segment B+C |
| Same-track replay (same src, readyState≥2) | **0–2** | Guard fast path — no fetch |
| Track skip (new src) | **80–250** | New fetch |
| Queue auto-advance | **80–220** | Often warm connection to same CDN host |
| Entitled stream (signed redirect) | **100–280** | Larger master MP3; WAV higher |
| Album track (nested preview) | Same as preview | Uses entity folder redirect |
