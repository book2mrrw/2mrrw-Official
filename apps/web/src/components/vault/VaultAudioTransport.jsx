"use client";

/**
 * VaultAudioTransport — playback for vault audio inside the chamber.
 *
 * Mounted once for the life of an open section and handed a slug, rather than
 * mounted per track. Changing track swaps the source on the same <audio>
 * element, so nothing here ever remounts: a remount would tear down the
 * element mid-decode and restart the sound.
 *
 * Two sources, in order of preference:
 *   1. /api/vault/audio/manifest?slug= — the encrypted HLS ladder. Variant and
 *      key requests are same-origin, so the session cookie rides along without
 *      withCredentials (which only affects cross-origin). Segments come from
 *      the public CDN and are useless without the key.
 *   2. /api/vault/media?slug= — a signed URL for the original file. This is the
 *      path an item takes before the worker has finished, or if it was uploaded
 *      through the plain File mode rather than as a master. Vault video already
 *      falls back the same way.
 *
 * A 403 is not a failure to retry: it means the listener does not hold the tier
 * this item needs, and it says so instead of spinning.
 */

import { useCallback, useEffect, useRef, useState } from "react";

let _Hls = null;
async function importHls() {
  if (typeof window === "undefined") return null;
  if (_Hls) return _Hls;
  try {
    const mod = await import("hls.js");
    _Hls = mod.default ?? mod;
    return _Hls;
  } catch (err) {
    console.error("[VaultAudioTransport] hls.js import failed", err);
    return null;
  }
}

function formatClock(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const s = Math.floor(seconds);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

export function VaultAudioTransport({ slug, title, onEnded }) {
  const audioRef = useRef(null);
  const hlsRef = useRef(null);
  // Guards against a slow load for an abandoned track resolving after the
  // listener has already moved on and clobbering the newer one.
  const loadIdRef = useRef(0);

  const [status, setStatus] = useState("idle");
  const [message, setMessage] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);

  const teardownHls = useCallback(() => {
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
  }, []);

  useEffect(() => teardownHls, [teardownHls]);

  /**
   * Clear the last track's readout the moment the slug changes, during render
   * rather than in an effect.
   *
   * An effect would land a frame later, so the new track would briefly show
   * the previous one's elapsed time and duration. Adjusting here also avoids
   * the cascading re-render a synchronous setState inside an effect causes --
   * React discards this render and restarts it before committing anything.
   */
  const [loadedSlug, setLoadedSlug] = useState(slug);
  if (slug !== loadedSlug) {
    setLoadedSlug(slug);
    setCurrent(0);
    setDuration(0);
    setPlaying(false);
    setMessage(null);
    setStatus(slug ? "loading" : "idle");
  }

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return undefined;

    const myLoad = ++loadIdRef.current;
    teardownHls();
    el.removeAttribute("src");
    el.load();

    if (!slug) return undefined;

    let cancelled = false;

    const stale = () => cancelled || loadIdRef.current !== myLoad;

    const playDirect = async () => {
      const res = await fetch(`/api/vault/media?slug=${encodeURIComponent(slug)}`, {
        cache: "no-store",
      });
      if (stale()) return;
      if (res.status === 403) {
        setStatus("denied");
        setMessage("This one needs a higher tier.");
        return;
      }
      if (!res.ok) {
        setStatus("error");
        setMessage("Could not load this track.");
        return;
      }
      const json = await res.json();
      if (stale()) return;
      if (!json?.url) {
        setStatus("error");
        setMessage("This item has no playable file yet.");
        return;
      }
      el.src = json.url;
      setStatus("ready");
      el.play().catch(() => {});
    };

    (async () => {
      try {
        const manifestUrl = `/api/vault/audio/manifest?slug=${encodeURIComponent(slug)}`;
        const probe = await fetch(manifestUrl, { cache: "no-store" });
        if (stale()) return;

        if (probe.status === 403) {
          setStatus("denied");
          setMessage("This one needs a higher tier.");
          return;
        }
        // 404 is the ordinary "not transcoded yet" case, not an error.
        if (!probe.ok) {
          await playDirect();
          return;
        }

        const Hls = await importHls();
        if (stale()) return;

        // Safari plays HLS natively and does not need (or want) hls.js.
        if (!Hls || !Hls.isSupported()) {
          el.src = manifestUrl;
          setStatus("ready");
          el.play().catch(() => {});
          return;
        }

        const hls = new Hls({
          enableWorker: true,
          lowLatencyMode: false,
          // Audio segments are a fraction of a video segment's size, so a
          // deep buffer here would prefetch minutes of a track the listener
          // may skip. These are sized for a 6-second audio segment.
          maxBufferLength: 30,
          maxMaxBufferLength: 60,
          maxBufferSize: 6 * 1000 * 1000,
          backBufferLength: 15,
          startLevel: -1,
          abrEwmaDefaultEstimate: 500_000,
          abrBandWidthFactor: 0.95,
          abrBandWidthUpFactor: 0.7,
          manifestLoadingMaxRetry: 0,
          manifestLoadingTimeOut: 3000,
          levelLoadingMaxRetry: 3,
          fragLoadingMaxRetry: 3,
        });

        hls.on(Hls.Events.ERROR, (_evt, data) => {
          if (!data?.fatal || stale()) return;
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            hls.startLoad();
            return;
          }
          if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            hls.recoverMediaError();
            return;
          }
          // Out of recoveries: the original file is still a valid way to hear
          // this, so fall back rather than leaving a dead transport.
          teardownHls();
          playDirect().catch(() => {
            setStatus("error");
            setMessage("Could not play this track.");
          });
        });

        hls.loadSource(manifestUrl);
        hls.attachMedia(el);
        hlsRef.current = hls;
        setStatus("ready");
        el.play().catch(() => {});
      } catch {
        if (stale()) return;
        setStatus("error");
        setMessage("Could not load this track.");
      }
    })();

    return () => {
      cancelled = true;
    };
    // Deliberately depends on the slug alone. A callback prop in here would
    // re-run the whole load -- and restart playback -- on every parent render
    // that passed a fresh arrow function.
  }, [slug, teardownHls]);

  const toggle = useCallback(() => {
    const el = audioRef.current;
    if (!el || !slug) return;
    if (el.paused) el.play().catch(() => {});
    else el.pause();
  }, [slug]);

  const scrub = useCallback((e) => {
    const el = audioRef.current;
    if (!el || !Number.isFinite(el.duration)) return;
    el.currentTime = (Number(e.target.value) / 1000) * el.duration;
  }, []);

  const pct = duration > 0 ? (current / duration) * 1000 : 0;
  const busy = status === "loading";
  const blocked = status === "denied" || status === "error";

  return (
    <div className="vault-audio-transport" data-active={slug ? "" : undefined}>
      <audio
        ref={audioRef}
        preload="none"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
        onDurationChange={(e) => {
          const d = e.currentTarget.duration;
          setDuration(Number.isFinite(d) ? d : 0);
        }}
        onEnded={() => {
          setPlaying(false);
          onEnded?.(slug);
        }}
      />

      {slug ? (
        <>
          <button
            type="button"
            className="vault-audio-transport__toggle"
            onClick={toggle}
            disabled={busy || blocked}
            aria-label={playing ? `Pause ${title}` : `Play ${title}`}
          >
            {busy ? "…" : playing ? "❚❚" : "▶"}
          </button>

          <span className="vault-audio-transport__body">
            <span className="vault-audio-transport__title">{title}</span>
            {blocked ? (
              <span className="vault-audio-transport__note">{message}</span>
            ) : (
              <input
                type="range"
                className="vault-audio-transport__seek"
                min={0}
                max={1000}
                step={1}
                value={pct}
                onChange={scrub}
                disabled={busy || !duration}
                aria-label="Seek"
              />
            )}
          </span>

          <span className="vault-audio-transport__clock">
            {formatClock(current)}
            {duration ? ` / ${formatClock(duration)}` : ""}
          </span>
        </>
      ) : null}
    </div>
  );
}

export default VaultAudioTransport;
