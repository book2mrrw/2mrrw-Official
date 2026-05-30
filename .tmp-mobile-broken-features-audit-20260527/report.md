# Mobile Broken Features Audit — 2026-05-27

**Repo:** `/Users/recharge/artist-platform`  
**Mode:** Read-only (no code changes)

---

## 1. Scrub bar not seeking

**File:** `src/components/audio/GlobalAudioPlayerBar.js`  
**Component:** `PlayerBarScrub` (lines 65–150)

### Scrub `<div>` JSX event props (lines 128–141)

| Prop | Value | Line |
|------|-------|------|
| `onMouseDown` | `onScrubStart` | 137 |
| `onTouchStart` | `onScrubStart` | 138 |
| `onTouchMove` | `seekFromEvent` | 139 |
| `onTouchEnd` | `seekFromEvent` | 140 |
| `onClick` | `seekFromEvent` | 141 |

**Note:** There is no separate inline handler for `onClick` / touch events on the scrub bar; all five props reference named callbacks defined above.

### `ratioFromEvent` (lines 75–89)

```javascript
  const ratioFromEvent = useCallback(
    (e) => {
      const el = scrubRef.current;
      if (!el || !maxSeek) return 0;
      const rect = el.getBoundingClientRect();
      const clientX = e.touches?.[0]?.clientX ?? e.changedTouches?.[0]?.clientX ?? e.clientX;
      const raw = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      if (previewOnly && duration > 0) {
        const capRatio = maxSeek / duration;
        return Math.min(raw, capRatio);
      }
      return raw;
    },
    [duration, maxSeek, previewOnly]
  );
```

### `seekFromEvent` (lines 91–98) — used by `onClick`, `onTouchMove`, `onTouchEnd`

```javascript
  const seekFromEvent = useCallback(
    (e) => {
      if (!maxSeek) return;
      const ratio = ratioFromEvent(e);
      onSeek(ratio * maxSeek);
    },
    [maxSeek, onSeek, ratioFromEvent]
  );
```

### `onScrubStart` (lines 100–107) — used by `onMouseDown`, `onTouchStart`

```javascript
  const onScrubStart = useCallback(
    (e) => {
      e.preventDefault();
      setDragging(true);
      seekFromEvent(e);
    },
    [seekFromEvent]
  );
```

### Drag continuation (lines 109–123)

While `dragging` is true, `window` listeners are attached for `mousemove`, `mouseup`, `touchmove` (passive: false), and `touchend` — all calling `seekFromEvent` on move and clearing drag on end.

### Parent `onSeek` wiring

`PlayerBarScrub` receives `onSeek={handleEngineSeek}` (line 628). `handleEngineSeek` (lines 536–543) calls `engineSeek(Math.max(0, Math.min(seconds, cap)))` with preview cap when applicable.

### Audit notes (scrub)

- Touch handlers **are present** (`onTouchStart`, `onTouchMove`, `onTouchEnd`).
- `onTouchStart` calls `e.preventDefault()` via `onScrubStart`.
- `onTouchEnd` invokes `seekFromEvent` again (same as move/click), not a dedicated “end drag only” handler.
- `onClick` is bound to `seekFromEvent` (not `onScrubStart`).
- If `maxSeek` is 0 (no duration), `seekFromEvent` no-ops early.

---

## 2. Modal “Something’s wrong” — grep results

**Command run:**

```bash
grep -rn "something.*wrong\|Something.*wrong\|somethingWrong\|error.*boundary\|ErrorBoundary" src/ | grep -v node_modules
```

**Exact output (every line):** see `raw-grep.txt` section “GREP 1”.

### String inventory

| Exact user-facing copy | Location |
|------------------------|----------|
| `Something went wrong` | `src/app/error.js:42` (Next.js route `error.js`) |
| `Something went wrong` | `src/system/errors/FallbackRenderer.js:14` (default `MinimalErrorSurface` message) |
| `Something went wrong in this view.` | `src/system/errors/ErrorBoundary.js:60` |
| `This panel closed unexpectedly.` | `src/system/errors/FallbackRenderer.js:50` (`ModalDismissToast` — what `ModalErrorBoundary` renders on error) |

**No match** for literal `Something's wrong` (apostrophe) or `somethingWrong` identifier in `src/`.

### `ModalErrorBoundary` behavior (`src/system/errors/ModalErrorBoundary.js`)

On error: unregisters modal stack, calls `onClose`, logs telemetry. **Renders:** `ModalDismissToast` (“This panel closed unexpectedly.”) — **not** “Something went wrong”.

### Modals on `page.js` wrapped with `ModalErrorBoundary`

| stackId | Lines |
|---------|-------|
| `mobile-nav-sheet` | 2539–2632 |
| `mobile-cart-sheet` | 2638–2659 |
| `stripe-checkout-overlay` | 2739–2760 |

### Modals on `page.js` **without** `ModalErrorBoundary`

| Modal | Lines |
|-------|-------|
| `ImmersivePreviewModal` (single preview) | 1558–1572 |
| `ImmersivePreviewModal` (feature) | 1574–1588 |
| `AlbumModal` | 1595–1608 |
| Ticket modal (inline div) | 1614+ |

`ModalPlayerShell` (`src/components/player/ImmersivePlayerEngine/ModalPlayerShell.js:91`) wraps children in `ModalErrorBoundary`.

---

## 3. My Account “Something’s wrong”

### Grep: account routes in `src/app/`

**Command:**

```bash
grep -rn "my-account\|myaccount\|account.*page\|/account" src/app/ | grep -v node_modules
```

**Result:** `(no matches)` — no dedicated `/account` or `my-account` App Router page under `src/app/`.

Account API used elsewhere: `/api/account/state` (e.g. `AuthContext.js`, `src/lib/control-system/account.js`) — not a navigable page route.

### More tab → My Account flow

1. **More tab** (`MOBILE_NAV_TABS`, line 57): `{ id: "more", label: "More", more: true }`.
2. Tap **More** → `openMobileNav()` (line 2482).
3. Sheet content wrapped in `ModalErrorBoundary` (`stackId="mobile-nav-sheet"`).
4. **My Account** button (line 2627): `onClick={()=>switchTab("account")}`.
5. `switchTab("account")` (lines 1379–1410): `startTransition` → `setActiveTab("account")`, closes mobile nav on mobile.

### What renders for `activeTab === "account"`

**File:** `src/app/page.js` lines 2357–2377 (inline tab panel, not a separate route).

When `currentUser` is truthy: account card, stats, quick links, admin sections, sign out.  
When falsy: “Loading account…” placeholder.

### Error boundary / try-catch on account path

| Mechanism | Present on account tab? |
|-----------|-------------------------|
| Dedicated `ErrorBoundary` around account block | **No** |
| `try/catch` in `switchTab` or account JSX | **No** |
| `ModalErrorBoundary` on nav sheet only | Yes (sheet closes + toast on sheet render error; not on tab content after switch) |
| Root `src/app/error.js` | Yes — uncaught render errors in `page.js` show full-page **“Something went wrong”** |
| `MediaErrorBoundary` in `layout.js` | Wraps `{children}`; on error renders `null` (no message) |

### Likely throw site (audit finding, not fixed)

Line 2363 (when `currentUser` is truthy):

```javascript
{currentUser.name[0].toUpperCase()}
```

If `currentUser.name` is `""` or missing, accessing `[0]` throws → can surface Next.js `error.js` (“Something went wrong”).  
Elsewhere the page uses safer fallbacks, e.g. `accountDisplayName` (line 1507): `currentUser?.name?.trim() || currentUser?.email?.split("@")[0] || "Member"`.

---

## 4. Mobile audio `playTrack` — sync `play()` before `await`?

**File:** `src/context/AudioContext.js`  
**Function starts:** line 1136

### First ~30 lines of `playTrack` (lines 1136–1165)

```javascript
  const playTrack = useCallback(async (track, options = {}) => {
    // Unlock audio on mobile Safari immediately
    // Must happen synchronously on user gesture
    const audioEl = audioRef.current;
    if (audioEl && audioEl.paused) {
      audioEl.volume = 0;
      const unlockPromise = audioEl.play().catch(() => {});
      audioEl.pause();
      audioEl.volume = 1;
      audioEl.currentTime = 0;
    }

    initWebAudio();
    await resumeWebAudioContextIfSuspended(audioCtxRef);
    setPreviewEnded(false);
    if (!track || (typeof track !== "object")) {
      console.error("[AudioContext] playTrack: invalid track", track);
      return false;
    }
    const normalized = normalizeTrack(track);
    if (!normalized.slug && !normalized.id && !normalized.src) {
      console.error("[AudioContext] playTrack: track missing identity and src", track);
      return false;
    }
    const presentation = resolvePlaybackPresentation(normalized, csModeRef.current, csUsingAlternateSrcRef.current);
    let nextTrack = {
      ...normalized,
      title: presentation.title,
      src: presentation.src,
      cover: presentation.cover,
    };
```

### Answer

**Yes.** `audioEl.play()` is invoked **synchronously** on the user-gesture stack (lines 1140–1145) **before** the first `await` (`await resumeWebAudioContextIfSuspended(audioCtxRef)` at line 1149).

The unlock pattern: silent `play()`, immediate `pause()`, reset volume and `currentTime`. `unlockPromise` is not awaited before continuing.

---

## Deliverable files

| File | Description |
|------|-------------|
| `report.md` | This document |
| `raw-grep.txt` | Exact grep command outputs |
| `manifest.txt` | File list |

**Zip target:** `/Users/recharge/Downloads/mobile-broken-features-audit-20260527.zip`
