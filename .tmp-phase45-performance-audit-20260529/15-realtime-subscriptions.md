# 15 — Realtime Subscriptions (Supabase Listeners)

## Supabase Realtime (Postgres changes)

**Grep result:** No `supabase.channel()` or `postgres_changes` subscriptions in `src/`.

Auth uses Supabase client for session only (`src/context/AuthContext.js`) — not realtime listeners.

## Control System SSE (primary realtime path)

**File:** `src/hooks/sync/useRealtimeEvents.js`

- EventSource to control system `/api/sync/stream` (external API via `buildControlSystemUrl`)
- 18 event types (release.created, media.uploaded, vault.updated, etc.)
- Singleton connection with ref counting
- Reconnect: exponential backoff, max 8 attempts
- Missed event replay via `/api/sync/replay`

**Consumer:** `src/hooks/sync/useSyncEngine.js` — used by:
- `src/hooks/media/useMediaAssets.js`
- `src/hooks/releases/useReleases.js`

**NOT used by:** `src/app/page.js` (catalog fetched via REST polling on mount, not SSE).

## Page catalog sync

Storefront catalog in page.js uses:
- Initial `/api/catalog/releases` fetch
- Manual `refreshAccountState` on library changes
- No live catalog SSE on main page

## Performance implications

| Aspect | Impact |
|--------|--------|
| SSE connection | 1 persistent connection when sync hooks mounted |
| Ref count | Disconnects when refCount=0 |
| Event burst | Replay up to 100 events on reconnect |
| page.js | No SSE — **no realtime overhead on main storefront** |

## Supabase auth listener

AuthContext subscribes to `supabase.auth.onAuthStateChange` (in bootstrap effect ~L220+) — lightweight, not data sync.

## Findings

1. **Main storefront avoids realtime subscriptions** — good for perf baseline.
2. **SSE isolated to sync engine hooks** — not globally mounted in layout.
3. **Catalog staleness** traded for simpler fetch model — acceptable product choice.
4. **No Supabase Realtime channel proliferation risk** — none present.

## Validation checklist

- [ ] Network: confirm no EventSource on `/` unless sync hooks added
- [ ] If catalog live updates desired — measure SSE + resync cost before enabling on page.js
