# Connection Reuse — keep-alive, TLS, Preconnect

**Probe date:** 2026-05-31  
**Preconnect:** `PlaybackNetworkHints` / `getPlaybackPreconnectOrigins()` (Phase 5.2.6)

---

## Two origins on preview path

| Connection | Host | Reuse |
|------------|------|-------|
| Document + API | `www.2mrrw.com` | HTTP/2 multiplex with page assets |
| Media bytes | `pub-643e4a94e0184b1fabf6522cfbb16f75.r2.dev` | **New connection** after 302 unless **preconnect** warmed |

---

## Curl warm vs cold (CDN Range 1k)

| Mode | connect | TLS (`appconnect`) | TTFB |
|------|---------|-------------------|------|
| Warm (default keep-alive) | **~9–12 ms** | **~26–33 ms** | **115–210 ms** |
| `--no-keepalive` ×2 | **~9–11 ms** | **~25–26 ms** | **118–128 ms** |
| Forced new route (`connect-to` trick) | **228 ms** | **250 ms** | **332 ms** |

**TLS session reuse:** CLI curl often **re-handshakes** (~28 ms) even on back-to-back requests — not equivalent to Safari `<audio>` pool (**requires-device-run**).

---

## keep-alive on R2 responses

```
Connection: keep-alive
```

Subsequent Range requests **may** reuse TCP/TLS to `pub-643…` — saves **~25–35 ms** TLS when reuse actually occurs.

---

## Preconnect savings (documented)

From `play-path-domains.js`:

```javascript
export const PRECONNECT_SETUP_SAVINGS_MS = { low: 40, typical: 80, high: 150 };
```

| Saved | Not saved |
|-------|-----------|
| DNS + TCP + TLS to CDN before tap | `/api/media/preview` **302** round-trip |
| **40–150 ms** on first byte when race wins | MP3 parse; API resolver on MISS |

---

## Redirect chain connection behavior

`-L` range chain: `time_redirect` **198 ms** includes **second connection setup** to CDN + API response wait — not pure HTTP redirect parsing.

---

## Comparison procedure (device)

1. Cold profile, no preconnect → play → `dumpPlaybackTiming().sourceAcquisition` (`dnsMs`, `tlsMs`, `ttfbMs`).
2. Reload with `PlaybackNetworkHints` → wait 2s → play.
3. Delta ≈ preconnect benefit on **CDN hop only**.
