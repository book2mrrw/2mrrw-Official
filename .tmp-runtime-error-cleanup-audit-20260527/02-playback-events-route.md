# Phase 2 — `/api/playback/events`

## Storefront

| Question | Answer |
|----------|--------|
| Route exists? | **No** — `src/app/api/playback/events/` absent (glob: 0 files) |
| Production POST www | **404** HTML |
| OPTIONS www | **204** (framework) |

## Control System (`2MRRW-Control-System`)

**File:** `src/app/api/playback/events/route.ts`

- **POST:** Validates `playbackEventSchema` (trackId, eventType ∈ play|pause|progress|complete|skip, optional position/duration/country).
- Normalizes aliases: `replay`→`play`, `seek|save|queue_add`→`progress`.
- Calls `trackPlaybackEventDurable(getUserId(request), …)` — analytics only.
- **OPTIONS:** `corsPreflight(request)` — allows www + apex origins with credentials.

## Client (`src/lib/control-system/client.js`)

```javascript
const shouldUseSameOrigin = isBrowser && normalizedPath.startsWith("/api/");
// browser: href = "/api/playback/events" on window.location.origin
// server: absolute NEXT_PUBLIC_CONTROL_SYSTEM_API_URL
```

`sendControlSystemPlaybackEvent` (`playback.js:52-71`):

- Uses `buildControlSystemUrl("/api/playback/events")`.
- `fetch` with `credentials: "include"`, `keepalive: true`.
- Returns `response.ok`; catch → `false`. **Never throws.**
- AudioContext **never awaits** return value.

## Root cause

Same-origin rewrite (stabilization-era) sends browser telemetry to storefront, but **no matching storefront route** was added. CS endpoint works when called directly.

## Recommendation (safest, minimal)

| Option | Risk | Verdict |
|--------|------|---------|
| **A. Thin storefront proxy** `POST /api/playback/events` → forward body + `x-control-session-id` to CS | Low — matches same-origin design, no AudioContext change | **Preferred** |
| B. Exclude path from same-origin in `buildControlSystemUrl` | Low — cross-origin POST; relies on CS CORS | Acceptable alternate |
| C. Noop / silent 404 | Lowest code | Loses analytics on www |
| D. Change AudioContext | **Disallowed** per scope | Reject |

**Chosen for Phase B:** Option A — proxy route only.
