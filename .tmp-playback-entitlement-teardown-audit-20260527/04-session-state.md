# Phase 4 — Playback Session State

## Session ID sources

| ID | Storage | Header / param | Used for |
|----|---------|----------------|----------|
| Control analytics session | `localStorage` `2mrrw_control_session_id` | `x-control-session-id` on CS fetch + playback events | CS analytics identity |
| Stream session | Supabase `stream_sessions.session_id` | Returned in JSON from `/api/library/stream` | Stream lifecycle / DELETE |
| Stream event | Supabase `stream_events.id` | JSON `streamEventId` | `/api/stream/end` analytics |
| Supabase auth | Cookies | `credentials: include` on API routes | Entitlement user resolution |
| Guest session | Cookie | `/api/guest/session` | Anonymous stream access |

## Control session ID (client)

**File:** `src/lib/control-system/playback.js:6-14`

```6:14:src/lib/control-system/playback.js
function controlSessionId() {
  if (typeof window === "undefined") return "";
  const key = "2mrrw_control_session_id";
  const existing = window.localStorage.getItem(key);
  if (existing) return existing;
  const generated = window.crypto?.randomUUID?.() || `session_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  window.localStorage.setItem(key, generated);
  return generated;
}
```

**CS resolution:** `2MRRW-Control-System/src/server/http.ts:126-138` — falls back to cf-ray or hashed UA/IP if header missing.

## Stream session pipeline

**File:** `src/lib/playback/stream-pipeline.js`

```3:4:src/lib/playback/stream-pipeline.js
export const STREAM_SIGNED_URL_TTL_SECONDS = 3600;
export const STREAM_SESSION_OVERLAP_SECONDS = 30;
```

```18:35:src/lib/playback/stream-pipeline.js
export async function findActiveStreamSession(admin, userId, productId) {
  const since = new Date(Date.now() - STREAM_SESSION_OVERLAP_SECONDS * 1000).toISOString();
  // ... query stream_sessions where started_at >= since and expires_at > now
}
```

**On each GET `/api/library/stream`** (non-force):

```58:62:src/app/api/library/stream/route.js
    const active = await findActiveStreamSession(admin, user.id, productId);
    if (active?.session_id) {
      await clearStreamSessionsForUserProduct(admin, user.id, productId);
    }
```

New session created every JSON fetch. Redirect-only first play does not store session in `streamMetaRef` until JSON fetch (upgrade/refresh/error retry).

## AudioContext stream meta ref

**File:** `src/context/AudioContext.js:976-993`

```976:993:src/context/AudioContext.js
  const resolveLibraryStreamForTrack = useCallback(async (track, { force = false } = {}) => {
    const data = await fetchLibraryStream(slug, { force });
    const meta = {
      slug,
      url: data.url,
      fetchedAt: Date.now(),
      expiresIn: data.expiresIn || 3600,
      streamEventId: data.streamEventId || null,
      sessionId: data.sessionId || null,
    };
    streamMetaRef.current = meta;
```

**Redirect fast-path gap:** Entitled play via `redirect=1` may play indefinitely with `streamMetaRef.current === null` until:
- `upgradeToFullStream` (Release card 2s timer)
- `onError` retry fetch
- `resume()` URL refresh
- visibility-change refresh

## Signed URL refresh

**File:** `src/lib/playback/stream-client.js:50-55`

```50:55:src/lib/playback/stream-client.js
export function streamUrlNeedsRefresh(meta, now = Date.now()) {
  if (!meta?.url || !meta?.fetchedAt) return true;
  const expiresInMs = (meta.expiresIn || 3600) * 1000;
  const expiresAt = meta.fetchedAt + expiresInMs;
  return expiresAt - now <= STREAM_REFRESH_BEFORE_EXPIRY_MS; // 5 min
}
```

Refresh triggers in `resume()` and `visibilitychange` — fetches new JSON, updates meta; may swap `audio.src` if implemented in resume path (`AudioContext.js:1639-1668`).

## Stream end / invalidation

**File:** `src/context/AudioContext.js:331-340`

```331:340:src/context/AudioContext.js
  const finalizeStreamSession = useCallback((meta, { completed = false, durationSeconds = 0 } = {}) => {
    if (!meta?.streamEventId && !meta?.sessionId) return;
    void endStreamAnalytics({
      streamEventId: meta.streamEventId || null,
      sessionId: meta.sessionId || null,
      durationSeconds,
      completed,
    });
    streamMetaRef.current = null;
  }, []);
```

**File:** `src/app/api/stream/end/route.js:28-29` — clears stream session in DB.

Called on: track change, stop, ended (full), access denied, stream errors.

## Concurrent stream (409)

**File:** `src/lib/playback/stream-client.js:92-97`

```92:97:src/lib/playback/stream-client.js
  if (res.status === 409) {
    const body = await res.json().catch(() => ({}));
    const err = new Error("concurrent_stream");
    err.code = "CONCURRENT_STREAM";
    err.sessionId = body.sessionId || null;
    throw err;
```

**File:** `src/context/AudioContext.js:1119-1131` — sets `streamConflict` state; user must confirm override. Does not auto-terminate.

## Race conditions

| Race | Scenario | Outcome |
|------|----------|---------|
| Redirect play + 2s upgrade | `streamMetaRef` null; upgrade fetches JSON + reloads src | Mid-play reload ~2s after start |
| Account state refresh + modal | Gated by `modalPlaySlugRef`; won't re-play after first | Low risk |
| Background swap + preview | Non-entitled starts preview; server allows stream | Upgrade to signed URL mid-play |
| Session clear on re-fetch | Each JSON GET clears prior sessions for user+product | Prior redirect URL may still work (R2 TTL) |
| Auth 401 during upgrade | `fetchLibraryStream` throws ACCESS_DENIED | pause + accessDenied (not jump to end) |
| Saved progress + metadata delay | Plays from 0 briefly, then seek to saved near-end | **Jump to end + terminate** |

## fetchLibraryStream auth errors

**File:** `src/lib/playback/stream-client.js:70-90`

```70:90:src/lib/playback/stream-client.js
  if (res.status === 403 || res.status === 401) {
    // telemetry signed.url.expired
    const err = new Error(
      res.status === 401 ? "authentication_required" : "access_denied"
    );
    err.code = "ACCESS_DENIED";
    err.status = res.status;
    err.slug = slug;
    throw err;
  }
```

401/403 do **not** invalidate CS playback-events session; they affect **library stream grant** only.
