# Phase 5.2.9 — Connection Reuse Analysis

**Hosts:** `pub-643e4a94e0184b1fabf6522cfbb16f75.r2.dev` (preview CDN), `www.2mrrw.com` (API redirect)  
**Preconnect:** `PlaybackNetworkHints` → `getPlaybackPreconnectOrigins()` (Phase 5.2.6)

---

## Preconnect vs cold (documented + curl)

| Mode | DNS+TCP+TLS | Source |
|------|-------------|--------|
| **Cold** (first request to CDN origin) | **+40–150 ms** additive | `PRECONNECT_SETUP_SAVINGS_MS` in `play-path-domains.js` |
| **Warm** (preconnect or prior play) | **~12–36 ms** in agent curl | connect ~11 ms + TLS ~28–35 ms; DNS ~1–2 ms |

**Preconnect does not:** fetch audio bytes, open Range, or populate media element buffer.

---

## Curl warm-pair (same host, 2026-05-31)

**URL:** nested `hourglass-preview.mp3`, Range `bytes=0-1023`

| Request | dns | tls | ttfb | total |
|---------|-----|-----|------|-------|
| r1 | 1.38 ms | 26.8 ms | 124.4 ms | 124.5 ms |
| r2 (immediate) | 1.34 ms | 28.2 ms | 192.8 ms | 192.9 ms |

**Note:** HTTP/1.1 keep-alive reuse does not always reduce TTFB on second request (edge variance). TLS still ~28 ms — connection may be renegotiated per request from curl CLI. **Browser `<audio>`** typically maintains warmer connection pools — **requires-device-run** for definitive reuse metrics.

---

## What preconnect saves on src→metadata

| Saved | Not saved |
|-------|-----------|
| DNS lookup to CDN origin (if not cached) | API `/api/media/preview` 302 round-trip |
| TCP + TLS to `pub-643…r2.dev` | MP3 demux / ID3 parse |
| ~40–150 ms on **first** CDN byte fetch | Entitled stream resolver (`/api/library/stream`) |

**Estimated impact on `playback-src-to-loadedmetadata`:** **40–150 ms** reduction when preconnect wins race before tap; **0 ms** when user taps before preconnect completes.

---

## Same-origin vs cross-origin

| Connection | Reuse pattern |
|------------|---------------|
| `www.2mrrw.com` → preview API | Same origin as document; HTTP/2 multiplex with HTML/JS |
| Redirect → `pub-643…r2.dev` | **New connection** unless preconnect warmed that origin |
| Entitled stream redirect | Same-origin `/api/library/stream?redirect=1` then 302 to signed R2 host — **second origin** |

---

## Procedure: compare preconnect on/off (dev)

1. **Cold:** Hard refresh, disable cache, remove `<PlaybackNetworkHints />` temporarily in dev branch **or** use fresh profile.
2. Tap play → `dumpPlaybackTiming().sourceAcquisition` — record `dnsMs`, `tlsMs`, `ttfbMs`.
3. **Warm:** Reload with hints enabled; wait 2 s; tap play on card below fold (preconnect should have run).
4. Delta on `dnsMs`+`tlsMs` ≈ preconnect savings.

**Do not ship hint removal** — measurement-only fork or Performance panel throttling.

---

## curl without warm connection (operator note)

CLI `curl` each invocation may not reuse connections like Safari. For cold vs warm:

```bash
# Cold: new connection (curl --no-keepalive)
curl --no-keepalive -o /dev/null -w 'ttfb=%{time_starttransfer}\n' -H 'Range: bytes=0-1023' 'https://pub-643e4a94e0184b1fabf6522cfbb16f75.r2.dev/previews/singles/hour-glass/hourglass-preview.mp3'

# Warm: run twice in one curl session (harder in shell) — prefer browser Resource Timing
```
