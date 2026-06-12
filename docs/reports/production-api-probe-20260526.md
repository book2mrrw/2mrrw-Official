# Production API probe — 2026-05-26

**Target:** https://www.2mrrw.com  
**Method:** `curl -i -s -L --max-time 15` (and HEAD for `/api/account/state`)  
**Source:** Subagent transcript `b313168c-ebdc-4432-ba0d-540142eafffc.jsonl` (parent `22ed5f23-e4b1-454c-aaaa-196208826de1`), verified with live re-probe same day.

## Site summary

| Check | Result |
|-------|--------|
| Overall | **Up** — Vercel serves responses; no timeout or 5xx on probed URLs |
| Homepage `https://www.2mrrw.com/` | **200** |
| Platform | Next.js on Vercel (`server: Vercel`, `strict-transport-security` present) |

**Takeaway:** There is no `/api` index or `/api/health` route in production. Use concrete API paths (e.g. `/api/account/state`).

---

## `/api`

| Field | Value |
|-------|--------|
| Final URL | `https://www.2mrrw.com/api` |
| Status | **404** (no redirect) |

**Notable response headers**

- `content-type: text/html; charset=utf-8`
- `content-length: 20398`
- `x-matched-path: /404`
- `access-control-allow-origin: *`
- `cache-control: public, max-age=0, must-revalidate`
- `server: Vercel`
- `x-vercel-cache: HIT`

**Body preview (first ~500 chars)**

```text
<!DOCTYPE html><html data-dpl-id="dpl_HUqc4w7sBGGywXYSpeMGzmVGZ6x7" lang="en"><head><meta charSet="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><link rel="preload" as="script" fetchPriority="low" href="/_next/static/chunks/15c0qix6i5tua.js?dpl=dpl_HUqc4w7sBGGywXYSpeMGzmVGZ6x7"/><script src="/_next/static/chunks/0pqt~8bl3ukh4.js?dpl=dpl_HUqc4w7sBGGywXYSpeMGzmVGZ6x7" async=""></script><script src="/_next/static/chunks/0kb-3_x3ib7st.js?dpl=dpl_HUqc4w7sBGGywXYSpeMGzmV
```

HTML Next.js not-found shell (not JSON).

---

## `/api/`

| Field | Value |
|-------|--------|
| Redirect chain | **308** → `location: /api` → **404** on `/api` |
| Final status | **404** |

**First hop (308)**

- `content-type: text/plain`
- `location: /api`
- `refresh: 0;url=/api`

**After follow to `/api`:** same 404 HTML as `/api` (headers and body preview match `/api` above).

---

## `/api/health`

| Field | Value |
|-------|--------|
| Final URL | `https://www.2mrrw.com/api/health` |
| Status | **404** |

**Notable response headers**

- `content-type: text/html; charset=utf-8`
- `content-length: 20398`
- `x-matched-path: /404`
- `access-control-allow-origin: *`
- `server: Vercel`
- `x-vercel-cache: HIT`

**Body preview:** Same HTML 404 shell as `/api` (DOCTYPE / Next chunks; not a JSON health payload).

---

## `/api/account/state`

### GET (no auth)

| Field | Value |
|-------|--------|
| Status | **200** |

**Notable response headers**

- `content-type: application/json`
- `x-matched-path: /api/account/state`
- `cache-control: public, max-age=0, must-revalidate`
- `server: Vercel`
- `x-vercel-cache: MISS`

**Body preview (first ~500 chars)**

```json
{"user":null,"library":[],"ownedSlugs":[],"membership":null,"collectorOwnerships":[],"vaultAccess":false,"vaultAccessDetail":{"tier":"public","hasVaultPass":false,"hasInnerCircleAccess":false},"subscriberActive":false,"collectorCard":false,"mediaProgress":[],"notifications":{"preferences":{"inAppEnabled":true,"emailEnabled":true,"smsEnabled":false,"webPushEnabled":false,"mobilePushEnabled":false,"releaseAlerts":true,"livestreamAlerts":true,"collectorAlerts":true,"vaultAlerts":true,"audioDiaryAle
```

Anonymous guest state: `user: null`, empty library, guest-tier permissions (truncated in preview).

### HEAD (no auth)

| Field | Value |
|-------|--------|
| Status | **200** |
| Body | None (HEAD) |

**Notable response headers**

- `content-type: application/json`
- `x-matched-path: /api/account/state`
- `server: Vercel`

---

## Endpoint matrix

| URL | Status | Content-Type | Notes |
|-----|--------|--------------|--------|
| `/api` | 404 | `text/html` | Next 404 page |
| `/api/` | 308 → 404 | `text/plain` then `text/html` | Trailing slash normalized to `/api` |
| `/api/health` | 404 | `text/html` | No health route deployed |
| `/api/account/state` GET | 200 | `application/json` | Guest payload without session |
| `/api/account/state` HEAD | 200 | `application/json` | No body |
