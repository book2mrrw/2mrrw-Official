# Route Refresh & Navigation Inventory

## router.refresh()

| File | When | Full reload? | Playback impact |
|------|------|--------------|-----------------|
| `app/verify-otp/page.js` L125 | After OTP verify + `router.push(nextPath)` | **Soft** — RSC payload refresh; client providers persist | `<audio>` survives; possible brief shell flicker; **no intentional audio stop** |

**Only `router.refresh` in src/** — narrow usage.

## router.push / replace (auth & commerce)

| Route | File | After action | Remounts page? | Playback |
|-------|------|--------------|----------------|----------|
| `/` | `success/page.js` | Collection CTA | Navigates away from success | Audio continues in layout provider |
| `/` | `gift/[token]/page.js` | Post-reveal | Same | Continues |
| `/join?next=…` | `collector/activate/page.js` | Unauthenticated | — | — |
| `/verify-otp` | `join`, `login` | Sign-in flow | New route | Audio in layout if already on site |
| `nextPath` | `verify-otp` | Post-OTP | Target route | + `router.refresh` |

## window.location (hard navigation)

| File | Target | Playback impact |
|------|--------|-----------------|
| `AuthContext.js` `enterGuest` | `postAuthRedirect` from sessionStorage | **Full navigation** — **stops playback** (document unload) |
| `app/page.js` | `/subscribe`, collectors route | Full load if used |
| `app/subscribe/page.js` | `/` back button | Full load |
| `subscribe` Stripe `return_url` | `/subscribe?subscribed=1` | Returns to subscribe page |

## window.history.replaceState

| File | Purpose | Playback |
|------|---------|----------|
| `page.js` | Strip `checkout=pending` query | None |

## Layout stability (playback-positive)

```43:58:src/app/layout.js
<AuthProvider>
  <AudioProvider>
    <AppAuthRoot>…children…</AppAuthRoot>
    <GlobalAudioPlayerBar />
  </AudioProvider>
</AuthProvider>
```

`AudioProvider` wraps all routes — **client-side route changes keep single audio element** unless `window.location` hard navigation.

## sessionStorage navigation hints

| Key | Set by | Effect |
|-----|--------|--------|
| `openTab` | success page CTA | Home opens My Music tab |
| `postAuthRedirect` | page deep-link auth | Hard redirect after guest |

## Risk: success → home

`router.push("/")` from success: user may still hear audio if they started playback on success page (unlikely) or returned to home with active session — **recovery + entitlement poll on home** can coincide with playing state.
