# 4. R2 / CDN headers (curl HEAD probes)

**Probe date:** 2026-05-28  
**CDN base:** `https://pub-643e4a94e0184b1fabf6522cfbb16f75.r2.dev` (`r2-public-cdn.js` fallback)

## Feature previews (catalog.js `preview_path`)

### `previews/i-dont-believe-you-preview.wav`

```
HTTP/1.1 200 OK
Content-Type: audio/wav
Content-Length: 5203902
Accept-Ranges: bytes
ETag: "2fa3105e10d50146aba3db07584c698a"
Server: cloudflare
```

- **TTFB (HEAD):** ~0.34s (first probe)
- **Size:** ~5.0 MB — **very large for a 30s preview cap**

### `previews/2-heavy-preview.wav`

```
HTTP/1.1 200 OK
Content-Type: audio/wav
Content-Length: 6649094
Accept-Ranges: bytes
```

- **Size:** ~6.3 MB

## Single previews (page.js `INLINE_SINGLES` → R2 `previews/*.mp3`)

| Object | Content-Type | Content-Length | TTFB (HEAD) |
|--------|--------------|----------------|-------------|
| `previews/hourglass-preview.mp3` | audio/mpeg | 831,656 (~812 KB) | ~0.11s |
| `previews/w2d-preview.mp3` | audio/mpeg | 1,230,016 (~1.2 MB) | ~0.19s |
| `previews/artificial-preview.mp3` | audio/mpeg | 1,039,936 (~1.0 MB) | ~0.11s |

## Full single audio on public CDN

### `singles/hour-glass/audio.mp3`

- **HTTP 404** on public bucket (expected — full files are signed-only)

## Production stream endpoint

### `GET https://2mrrw.com/api/library/stream?slug=hour-glass&redirect=1` (no session cookie)

- **HTTP 307** → `https://www.2mrrw.com/api/library/stream?...` (www canonicalization)
- Unauthenticated play not measurable without cookies; entitled path adds server work before 302.

## Header gaps / observations

| Header | Observed | Impact |
|--------|----------|--------|
| `Accept-Ranges: bytes` | Yes on CDN objects | Good for seeking / Safari |
| `Cache-Control` | **Not present** on R2 public responses | Browser heuristics only; repeat visits less predictable |
| `Content-Encoding` | None | Uncompressed WAV/MP3 |
| CF-RAY | Present | Cloudflare edge (DFW in probes) |

## Performance implication

- Feature section previews pay a **4–6× size penalty** vs single MP3 previews → longer time-to-`canplay` on cellular.
- WAV vs MP3: no Content-Encoding; entire file may be fetched aggressively with `preload="auto"`.

Raw probe log: `raw-curl-probes.txt` (partial — see section 9).
