# Collector Validation — Hybrid Streaming Canary (Phase 5.3)

**Run date:** 2026-05-31  
**Section result:** **PASS** (code-path audit)

---

## Principle

Hybrid streaming affects **online entitled playback** only. Collector downloads, vault access, and ownership records remain **master-authoritative**. Stream renditions are playback optimizations, not ownership grants.

---

## Collector protection matrix

| Capability | Asset class | Resolver | Hybrid impact |
|------------|-------------|----------|---------------|
| **Offline download** | Master (blob URL) | `getOfflinePlaybackUrl` in `resolvePlaybackSrc` | **None** — runs before stream redirect |
| **Vault content** | Gated vault media | `/api/vault/media` | **None** — separate API |
| **Ownership records** | Supabase purchases/library | `/api/account/state` → entitlements | **None** — no client override |
| **Collector card access** | Entitlement flag | `userCanStreamProduct` + `collectorCardOwner` | **None** — same stream API, server picks asset |
| **Master files in R2** | `digital-assets/` | Never modified by hybrid pipeline | **Invariant** — read-only for transcode |
| **Download quality** | Full master WAV/FLAC | Offline cache stores master bytes | **Not downgraded to AAC** |

---

## Offline master short-circuit

**File:** `src/lib/music-access.js` — `resolvePlaybackSrc`

```javascript
if (userId && track.slug && access?.canStream) {
  const offline = getOfflinePlaybackUrl(userId, track.slug);
  if (offline) return offline;  // blob: — bypasses /api/library/stream entirely
}
```

**Order:** Offline master → library stream redirect → preview CDN.

Hybrid `STREAM_PLAYBACK_PREFERRED` is evaluated **server-side** in `resolvePlaybackKey` — never reached when offline blob URL is returned client-side.

**Validation:** **PASS** — downloaded masters unaffected by hybrid flags.

---

## canOffline entitlement

**File:** `src/lib/music-access.js` — `resolveContentAccess`

```javascript
canOffline:
  trackAccess.canStream &&
  (tier === "subscriber" || tier === "collector" || trackAccess.owned),
```

Offline capability tied to entitlement tier, not stream asset presence. Hybrid flags do not modify `canOffline`.

---

## Vault isolation

Vault playback uses `/api/vault/media` — not `/api/library/stream`. Hybrid resolver does not intercept vault paths.

**Validation:** **PASS** — vault remains gated and master-authoritative.

---

## Ownership authoritative source

```
payment/webhook → Supabase → /api/account/state → AuthContext → resolveTrackAccess
```

Hybrid flags are server env only — no client entitlement override. Collector card, purchase, and subscription checks unchanged in `userCanStreamProduct`.

---

## Stream vs master for collectors (online play)

When collector plays online (no offline cache):

1. Client: `libraryStreamRedirectSrc` → `/api/library/stream`
2. Server: entitlement OK → `resolvePlaybackKey`
3. With PREFERRED=1 + stream asset: serves AAC stream
4. Without stream asset: serves master (fallback)

**Collector online play may use AAC stream when available** — this is intentional latency optimization, not a rights reduction. Download/offline paths always use master.

---

## AUTO_GENERATE_STREAM_ASSETS safety

Upload/backfill pipeline (`stream-upload-pipeline.js`):

- Reads master from `digital-assets/` (read-only)
- Writes new object to `streaming/` prefix
- Master upsert **never blocked** by stream failure
- Stream errors appear in `streamResults` only

**Validation:** **PASS** — masters protected.

---

## Rollback impact on collectors

Setting `HYBRID_STREAMING_ENABLED=0`:

- Online play reverts to master signing
- Offline downloads unchanged (already master)
- Vault unchanged
- Ownership unchanged

**Validation:** **PASS**

---

## Section result

**PASS** — Downloads, vault, ownership, and masters remain authoritative. Hybrid stream renditions are an online playback optimization layer only.
