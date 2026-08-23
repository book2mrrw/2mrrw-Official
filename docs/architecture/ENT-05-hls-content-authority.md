# ENT-05 — HLS Content Authority: locked design

**Status:** DESIGN LOCKED · implementation assigned to **Slice H1 — HLS Content Authority**
**Locked:** 2026-08-22 (E0-B)
**Implementation slot:** Slice H1, isolated from playback slices because it changes
encryption identity and requires its own regression + rollback path.

This document exists so ENT-05 is not an indefinite "later" item. The design,
invariants, and acceptance criteria are fixed now; only the code lands later.

---

## 1. The exposure, precisely

Three properties compose. None is a defect alone; together they make one
extraction permanent and shareable.

| # | Property | Location |
|---|---|---|
| 1 | Segments are served from a **public** Cloudflare R2 CDN with no auth of any kind | `hls/variant/route.js:26-28,124` |
| 2 | The key token is a **pure bearer credential**, 7.75 h, never rebound to the session — `payload.userId` is used only for rate limiting, never compared to the caller | `hls/key/route.js:29-52`, `hls/token.js:36` |
| 3 | The AES-128 key is **deterministic and permanent** per `(slug, trackSlug)`: `HMAC-SHA256(HLS_MASTER_SECRET, "2mrrw:hls:<slug>[:<trackSlug>]:key")[0:16]` | `hls/derive-key.js:32-58` |

**Consequence.** A key-token URL is plainly visible in the network tab of any
legitimately entitled session. It works from anywhere, with no cookie, for 7.75
hours, and can be pasted to anyone. Because segments are permanently public and
the key never rotates, the extracted key grants **permanent** access to that
track and can be redistributed indefinitely. Rotation requires re-transcoding the
entire catalogue.

**Interaction with E0.** Before E0 an attacker could self-promote to admin
(ENT-01/ENT-02) and harvest keys for the whole catalogue. E0 closes the
escalation; it does not change the key exposure for a genuinely entitled user.

---

## 2. What is honestly achievable

Stated plainly so the target is not overclaimed:

> AES-128 HLS delivers key material to the client because the client must
> decrypt. **No amount of token engineering prevents an entitled user from
> retaining the key.** Strong persistent protection against an entitled user is a
> DRM problem — FairPlay / Widevine / PlayReady — not a token problem.

Slice H1 therefore targets a different and achievable goal:

**Make an extracted credential useless to anyone other than the session that
earned it, and make any extracted key material expire.**

That defeats casual sharing, link redistribution, and scraping — the realistic
threats — without pretending to defeat a determined local extractor.

---

## 3. Locked design

### 3.1 Session-bound key tokens

Key tokens gain a binding claim and are validated against the live request.

```
signKeyToken({ slug, trackSlug, userId, sessionBinding, representationVersion })

payload:
  typ  "key"
  sub  userId
  sid  sessionBinding      ← HMAC of the session identifier, not the raw value
  rv   representationVersion
  slg  slug
  ts   trackSlug | null
  exp  now + KEY_TTL
```

At `/api/library/hls/key`, after signature verification:

1. Resolve the caller through `getFanSessionUser() ?? getGuestUser()`.
2. Reject unless `payload.sub === caller.id`.
3. Reject unless `payload.sid` matches the binding recomputed from the caller's
   current session.

A copied URL then fails immediately in any other browser or session.

> **Constraint:** the check must stay a single in-memory recomputation plus at
> most one cached session read. The key endpoint is on the critical path for
> first audio; it must not acquire a database round trip.

### 3.2 TTL reduction

| Token | Now | Target |
|---|---|---|
| variant | 28 800 s (8 h) | **900 s** (15 min) |
| key | 27 900 s (7.75 h) | **300 s** (5 min) |

The current 7.75 h exists to avoid mid-session 403s, because
`#EXT-X-PLAYLIST-TYPE:VOD` means hls.js never re-fetches the variant playlist.
Short TTLs therefore **require** playlist refresh first (§3.3); shipping them
without it reintroduces the exact 55-minute silent-failure bug the long TTLs were
introduced to fix. **Ordering is mandatory: §3.3 lands before §3.2.**

### 3.3 Playlist refresh without session failure

Implement one of, decided during H1 by measurement:

- **A — hls.js key loader hook.** Override `loader` for `KEY` fragments so a 401
  triggers a silent re-fetch of the master playlist and a fresh key token, with
  no user-visible interruption. Preferred: no manifest semantics change.
- **B — `#EXT-X-PLAYLIST-TYPE:EVENT` + short `#EXT-X-TARGETDURATION`.** Makes
  hls.js re-poll the variant playlist naturally. Simpler, but changes VOD
  seek/buffer behaviour and must be regression-tested against the full physical
  matrix.

Native Safari HLS cannot use option A. Safari must be covered by option B or by
accepting a longer TTL specifically on the native path, recorded as a documented
per-platform difference rather than an oversight.

### 3.4 Representation-scoped encryption identity

Key derivation gains a version component:

```
HMAC-SHA256(HLS_MASTER_SECRET,
            "2mrrw:hls:v<representationVersion>:<slug>[:<trackSlug>]:<purpose>")[0:16]
```

`representationVersion` is stored on `hls_manifests` and incremented whenever a
track is re-transcoded. Consequences:

- Re-transcoding a single track rotates only that track's key.
- A token scoped to `rv=3` cannot decrypt `rv=4` segments.
- Targeted revocation of one release becomes possible without a catalogue-wide
  re-transcode.

> **The existing derivation string is LOCKED and must not be edited in place.**
> Adding the `v<n>` segment changes every derived key, so it ships **only**
> alongside a re-transcode, behind `representationVersion`, with the un-versioned
> form retained for `rv = 0` (all existing content). This is the single highest-risk
> change in H1 and is the reason H1 is an isolated slice.

### 3.5 Explicit revocation

A `hls_revocations` table keyed by `(userId, representationVersion)` or
`(slug, representationVersion)`. Checked at key issuance — not at key delivery,
so the hot path stays clean. Entitlement revocation (E0-B generation bump) also
invalidates outstanding key tokens at next issuance.

---

## 4. Invariants (locked now, enforced in H1)

| ID | Invariant |
|---|---|
| **INV-HLS-1** | A key token is valid only for the principal it was issued to. Possession alone is never sufficient. |
| **INV-HLS-2** | A key token is valid only for the session binding it was issued under. |
| **INV-HLS-3** | Key material expires. No credential granting decryption may outlive a bounded, short window. |
| **INV-HLS-4** | Encryption identity is scoped to a representation version. Authorization for one version never applies to another. |
| **INV-HLS-5** | Revocation is explicit and modelled, never implied by expiry alone. |
| **INV-HLS-6** | Shortening a token TTL may never reintroduce mid-session playback failure. Refresh capability lands first. |
| **INV-HLS-7** | The key-delivery endpoint acquires no database round trip. |

---

## 5. Acceptance criteria for Slice H1

1. A key-token URL copied to a different browser/session returns **403**.
2. A key-token URL replayed after its TTL returns **403**.
3. A continuous 3-hour playback session completes with **zero** key-related errors,
   on Chrome (hls.js) and Safari (native).
4. Re-transcoding one track invalidates only that track's prior key tokens.
5. Physical HARDENING-B matrix still **18/18**; differential still **8/8**.
6. Entitlement tier matrix (Entry / Purchaser / Subscriber / Collector / Admin)
   verified against real HLS delivery.
7. Rollback proven: reverting `representationVersion` to 0 restores playback of
   all pre-existing content without re-transcoding.

---

## 6. Explicitly out of scope

- DRM (FairPlay / Widevine / PlayReady). If protection against an *entitled*
  user extracting decrypted media becomes a requirement, that is a separate
  architecture decision with licensing, platform, and cost implications. It is
  not achievable by improving AES-128 HLS token handling, and this document does
  not claim otherwise.
- Watermarking / forensic traceability.
- Making the R2 segment bucket private. Considered and rejected: it removes the
  CDN edge-cache benefit that makes the current architecture scale, and it does
  not defeat an attacker who already holds a valid session.
