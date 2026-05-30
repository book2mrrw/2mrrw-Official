# QA Verification Checklist

**Production:** https://www.2mrrw.com  
**Deploy:** `dpl_3STkrSuFwUchTvtNmhDyux1XGobP`

## Mobile Safari — Account

- [ ] Sign in with user whose profile has **empty display name** (email only).
- [ ] More → **My Account** — tab loads; avatar shows first letter of email (or `?`), not full-page error.
- [ ] Account tab shows email, stats, sign out.
- [ ] Mobile nav sheet header still shows correct initial/name.

## Mobile Safari — Singles / features

- [ ] Tap a single card — immersive preview opens (slide-up, palette, preview bar).
- [ ] Close via drag pill / backdrop — no stuck scroll lock.
- [ ] Open feature modal from catalog — same behavior.
- [ ] Preview play / pause works (gesture unlock).

## Mobile Safari — Albums

- [ ] Open album modal — track list or “Track list unavailable” (no crash).
- [ ] Album with tracks — select track, mini player updates.
- [ ] Close album modal cleanly.

## Error boundary (if simulating)

- [ ] Force a modal child throw in dev — see “Try again” / “Close”, not whole-site `error.js`.
- [ ] Close returns to catalog; retry re-mounts modal when parent state still open.

## Regression

- [ ] Admin account: stream access unchanged on paid/Vault content.
- [ ] Desktop modals unchanged visually.
- [ ] Stripe checkout overlay still works.
- [ ] No new console spam in production build.

## Build / deploy

- [x] `npm run build` passed locally.
- [x] Pushed `main` → `db88530`.
- [x] `npx vercel deploy --prod --yes` — READY, aliased to www.2mrrw.com.
