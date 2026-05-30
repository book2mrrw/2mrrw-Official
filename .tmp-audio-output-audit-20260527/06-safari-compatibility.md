# 06 — Safari Compatibility

Date: 2026-05-27

---

## Element attributes (Safari / iOS)

**CONFIRMED-CODE:**

```2083:2088:src/context/AudioContext.js
      <audio
        ref={audioRef}
        preload="auto"
        playsInline
        {...{ "webkit-playsinline": "", "x-webkit-airplay": "allow" }}
```

| Requirement | Status | Notes |
|-------------|--------|-------|
| `playsInline` | ✅ Set | Prevents fullscreen hijack on iOS |
| `webkit-playsinline` | ✅ Set | Legacy iOS |
| `muted` for autoplay | N/A | Play is user-gesture driven |
| `crossOrigin` | ❌ **Not set** | Required for Web Audio + cross-origin R2 |
| AirPlay | `x-webkit-airplay="allow"` | May route to external device — **NEEDS-RUNTIME** if silent on AirPlay |

---

## AudioContext autoplay / gesture (Safari)

**CONFIRMED-CODE:** Safari starts `AudioContext` in `suspended` state until user gesture.

**CONFIRMED-CODE:** Code attempts resume on `playTrack` only:

```987:989:src/context/AudioContext.js
    if (audioCtxRef.current?.state === "suspended") {
      void audioCtxRef.current.resume();
    }
```

| Safari quirk | Code coverage | Gap |
|--------------|---------------|-----|
| Context suspended at creation | Resume on first playTrack | Not awaited; no retry |
| Resume needed after lock screen | None | **NEEDS-RUNTIME** |
| Resume on toggle play | `resume()` lacks ctx.resume() | **CONFIRMED-CODE gap** |
| Multiple AudioContexts | vault-audio separate | Independent |

**NEEDS-RUNTIME:** iOS Safari — after play tap, verify in Web Inspector:

```javascript
// Break in initWebAudio
// audioCtxRef.current.state === 'running' ?
```

---

## createMediaElementSource (Safari)

**CONFIRMED-CODE:** Single call guarded — Safari throws on duplicate.

**CONFIRMED-CODE:** Failure caught and logged (`:467-469`). If throw occurs after partial setup, behavior undefined — **NEEDS-RUNTIME**.

**Safari + cross-origin:** Same as Chrome — MediaElementAudioSourceNode outputs silence without CORS-enabled element + headers.

---

## WebKit audio routing

**CONFIRMED-CODE:** Once MediaElementSource attached, WebKit routes element audio only through graph (same as spec).

**NEEDS-RUNTIME:** iOS silent switch / Focus mode / Bluetooth handoff — OS-level, not in code.

---

## playsInline + hidden element

**CONFIRMED-CODE:** Element is `display: none` but `playsInline` set.

**NEEDS-RUNTIME:** Some iOS versions restrict background/hidden playback. User report of stream 206 + UI playing suggests element is not fully blocked (time likely advances).

---

## Range requests / 206 (Safari)

**CONFIRMED-CODE:** Stream infrastructure delivers 206 Partial Content (user report + redirect to signed R2).

Safari supports byte-range on `<audio>` for MP3/AAC. **CONFIRMED-CODE:** No code disables range requests.

**NEEDS-RUNTIME:** Verify Content-Type and codec compatibility if `audio.error` set (code 4 MEDIA_ERR_SRC_NOT_SUPPORTED).

---

## Preview vs full stream on Safari

**CONFIRMED-CODE:** Preview URLs from `catalogPreviewAudioUrl` — public CDN paths, cross-origin.

**CONFIRMED-CODE:** Full stream — signed R2 URL after redirect.

Both cross-origin from `www.2mrrw.com` → same crossOrigin/Web Audio constraint.

---

## PWA / standalone

**CONFIRMED-CODE:** `isStandalonePwa()` used for beforeunload behavior (`:218-224`, `:1882`).

**NEEDS-RUNTIME:** Standalone PWA may differ in autoplay unlock persistence.

---

## Device change handler

**CONFIRMED-CODE:**

```901:912:src/context/AudioContext.js
      onDeviceChange = () => {
        navigator.mediaDevices.enumerateDevices().then((devices) => {
          const hasAudioOut = devices.some((d) => d.kind === "audiooutput");
          if (!hasAudioOut && stateRef.current.isPlaying) {
            userPausedRef.current = true;
            audio.pause();
          }
        });
      };
```

Safari support for `enumerateDevices` `audiooutput` is limited — may false-negative and pause playback.

**NEEDS-RUNTIME:** Safari desktop — plug/unplug headphones during play.

---

## Safari verification matrix

| Test | Expected if passing | Code gap if failing |
|------|---------------------|---------------------|
| Tap play → ctx.state | `running` | resume not awaited |
| `<audio>.crossOrigin` | `anonymous` for Web Audio + R2 | **not set in code** |
| `<audio>.volume` | > 0 after 3s | swell / slider |
| `<audio>.muted` | false | — |
| `<audio>.paused` | false when UI playing | playAudioIfNotPaused |
| Analyser byte data | non-zero | CORS silent node |
| Waveform UI | animates | analyser receiving signal |

---

## Browser probe limits (this audit run)

**CONFIRMED-RUNTIME:** `https://www.2mrrw.com` unauthenticated shows AuthGate; **0 `<audio>` elements** after 3s wait.

Authenticated Safari/iOS testing was **not performed** — requires user OTP sign-in.
