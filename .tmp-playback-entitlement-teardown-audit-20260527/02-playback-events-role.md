# Phase 2 — `/api/playback/events` Role

## Callers (grep: `playback/events`, `sendControlSystemPlaybackEvent`)

| Location | Role |
|----------|------|
| `src/lib/control-system/playback.js:52-71` | Sole implementation — POST telemetry |
| `src/context/AudioContext.js:571-576` | `persistPlayback()` on play/pause/progress/complete |
| `src/context/AudioContext.js:1316-1320` | Explicit `replay` event |
| `src/context/AudioContext.js:1707-1711` | Explicit `seek` event |

**Storefront has no route** at `src/app/api/playback/events/` (glob returns 0 files).

## Client implementation

**File:** `src/lib/control-system/playback.js`

```52:71:src/lib/control-system/playback.js
export async function sendControlSystemPlaybackEvent(track, eventType, details = {}) {
  const target = buildControlSystemUrl("/api/playback/events");
  if (!target) return false;

  try {
    const response = await fetch(target.href, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "x-control-session-id": controlSessionId(),
      },
      credentials: "include",
      keepalive: true,
      body: JSON.stringify(playbackEventPayload(track, eventType, details)),
    });
    return response.ok;
  } catch {
    return false;
  }
}
```

## Same-origin rewrite (root cause of storefront 404)

**File:** `src/lib/control-system/client.js`

```39:51:src/lib/control-system/client.js
  const shouldUseSameOrigin = isBrowser && normalizedPath.startsWith("/api/");
  const resolvedApiBaseUrl = shouldUseSameOrigin ? window.location.origin : apiBaseUrl;
  const url = shouldUseSameOrigin
    ? new URL(normalizedPath, window.location.origin)
    : new URL(path.startsWith("/") ? `${apiBaseUrl}${path}` : `${apiBaseUrl}/${path}`);
  // ...
  const href = shouldUseSameOrigin ? `${url.pathname}${url.search}` : url.toString();
  return { apiBaseUrl: resolvedApiBaseUrl, href };
```

In the browser, `/api/playback/events` resolves to **storefront origin**, not Control System.

## Control System handler

**File:** `2MRRW-Control-System/src/app/api/playback/events/route.ts`

```26:47:2MRRW-Control-System/src/app/api/playback/events/route.ts
export async function POST(request: Request) {
  const raw = await request.json().catch(() => ({}));
  const parsed = playbackEventSchema.safeParse({ ... });
  if (!parsed.success) {
    return withCors(fail("Invalid playback event payload", 400, parsed.error.flatten()), request);
  }
  return withCors(
    ok(
      await trackPlaybackEventDurable(getUserId(request), {
        ...parsed.data,
        sessionId: getSessionId(request)
      })
    ),
    request
  );
}
```

**Purpose:** Analytics + durable progress (`trackPlaybackEventDurable`). **Not** an entitlement validator or playback heartbeat that revokes stream access.

**File:** `2MRRW-Control-System/src/server/releases/releaseService.ts:631-663`

- Updates playback progress when `positionSeconds` present
- Records stream analytics when `listenedSeconds` present
- Marks recently played on `play` / `complete`
- Returns JSON; no callback to storefront

## Parallel storefront telemetry

**File:** `src/context/AudioContext.js:555-570`

```555:570:src/context/AudioContext.js
        fetch("/api/media/playback", {
          method: "POST",
          // ...
          body: JSON.stringify({
            slug: track.slug,
            eventType,
            positionSeconds: audio.currentTime,
            durationSeconds: isFinite(audio.duration) ? audio.duration : 0,
            completed: eventType === "complete",
          }),
        }).catch(() => {});
```

**File:** `src/app/api/media/playback/route.js` — persists to Supabase `media_stream_events` + `media_playback_progress`. Also fire-and-forget from client (`.catch(() => {})`).

## Does failure trigger teardown?

**No.** Evidence:

1. `sendControlSystemPlaybackEvent` return value is **never checked** in AudioContext (void / no await).
2. `persistPlayback` wraps fetch in `.catch(() => {})` for storefront route.
3. No listener, hook, or effect subscribes to playback-events success/failure.
4. CS handler does not emit entitlements or session invalidation.

The failing `/api/playback/events` request is **correlated in time** with playback start (fires on `onPlay` → `persistPlayback("play")`) but is **not causal** for termination.

## Production probes (2026-05-27)

| Target | Method | Status | Body |
|--------|--------|--------|------|
| `https://www.2mrrw.com/api/playback/events` | OPTIONS | 204 | — |
| `https://www.2mrrw.com/api/playback/events` | POST | **404** | Next.js HTML page |
| `https://2mrrw-control-system.vercel.app/api/playback/events` | OPTIONS | 204 | — |
| `https://2mrrw-control-system.vercel.app/api/playback/events` | POST | **200** | `{"data":{"userId":"anon_...","trackId":"hour-glass",...}}` |

## Payload requirements (CS)

`trackId` required (min 1 char). Client resolves:

```29:31:src/lib/control-system/playback.js
  const trackId = track.metadata?.controlSystemTrackId || track.trackId || track.id || track.slug || null;
```

Catalog tracks typically send **slug** as `trackId` — valid for CS schema.

## Session header

`x-control-session-id` from `localStorage` key `2mrrw_control_session_id` (same pattern as `browserControlSessionId` in `client.js`). CS `getSessionId` reads this header; used for analytics identity only.
