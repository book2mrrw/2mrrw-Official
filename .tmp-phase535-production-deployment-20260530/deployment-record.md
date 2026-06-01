# Deployment Record — Phase 5.3.5

**Run date:** 2026-05-31

---

## Git push

| Field | Value |
|-------|-------|
| Remote | `origin` → `https://github.com/book2mrrw/2mrrw-Official` |
| Branch | `main` |
| Range pushed | `82aeeb0..250e2bb` |
| Commit | `250e2bbc5fce7f650e12977c2dcdf499670fd33f` |
| Message | Phase 5.3.4 Hybrid Streaming Activation |
| Status | **SUCCESS** |

---

## Deployments

### 1. GitHub auto-deploy (initial)

| Field | Value |
|-------|-------|
| Deployment ID | `dpl_7ViL8wpgJpzRwq1gDuHH62v5xJ7g` |
| State | READY |
| Target | production |
| Commit | `250e2bb` |
| URL | `https://artist-platform-aw9to6r3r-eellian-morrows-projects.vercel.app` |
| Inspector | https://vercel.com/eellian-morrows-projects/artist-platform/7ViL8wpgJpzRwq1gDuHH62v5xJ7g |

### 2. Production redeploy (env pickup) — **ACTIVE**

| Field | Value |
|-------|-------|
| Deployment ID | **`dpl_6qi3Y5iG8csx4vrjws2wdRdh7r83`** |
| State | **READY** |
| Target | production |
| Commit | `250e2bb` |
| Action | `redeploy` of `dpl_7ViL8wpgJpzRwq1gDuHH62v5xJ7g` |
| Build ready (UTC) | `2026-05-31T23:45:37Z` |
| Build duration | ~52s |
| Deployment URL | `https://artist-platform-5rss6r4ki-eellian-morrows-projects.vercel.app` |
| Production aliases | `https://www.2mrrw.com`, `https://2mrrw.com` |
| Inspector | https://vercel.com/eellian-morrows-projects/artist-platform/6qi3Y5iG8csx4vrjws2wdRdh7r83 |

---

## CLI deploy attempt

| Command | Result |
|---------|--------|
| `npx vercel deploy --prod --yes` | **FAILED** — `Not authorized` (CLI upload) |
| `npx vercel redeploy dpl_7ViL8wpgJpzRwq1gDuHH62v5xJ7g` | **SUCCESS** |

GitHub integration + redeploy completed production rollout.

---

## Deployment health

| Check | Result |
|-------|--------|
| Build state | READY |
| Home page | HTTP 200 |
| Region | `iad1` |
