'use client';
import { memo, useEffect, useRef, useState } from 'react';
import { TrackVisualPlayer } from '@/lib/track-visuals/player';

/** Read-only inputs from the modal. Never sends commands to the music player. */
function TrackVisual({ slug, trackSlug = '', visible, playing, reducedMotion = false }) {
  const videoRef = useRef(null), playerRef = useRef(null);
  const playRef = useRef(false), [readyIdentity, setReadyIdentity] = useState(null);
  const identity = `${slug || ''}:${trackSlug}`;
  useEffect(() => { playRef.current = Boolean(visible && playing && !reducedMotion); }, [visible, playing, reducedMotion]);
  useEffect(() => {
    if (!slug) return undefined;
    const abort = new AbortController();
    let disposed = false, player;
    async function prepare() {
      try {
        const res = await fetch(`/api/track-visuals?${new URLSearchParams({ slug, trackSlug })}`, { signal: abort.signal, cache: 'no-store' });
        if (!res.ok) return;
        const { visual } = await res.json();
        if (disposed || !visual?.manifestUrl || !videoRef.current) return;
        player = new TrackVisualPlayer(videoRef.current, {
          onReady: () => { if (!disposed) setReadyIdentity(identity); },
          onFailure: () => { if (!disposed) setReadyIdentity(null); },
        });
        playerRef.current = player;
        player.setPlaying(playRef.current && !document.hidden);
        await player.load(visual.manifestUrl);
      } catch { /* The existing artwork remains the fallback. */ }
    }
    void prepare();
    return () => { disposed = true; abort.abort(); player?.destroy(); if (playerRef.current === player) playerRef.current = null; };
  }, [slug, trackSlug, identity]);
  useEffect(() => {
    const update = () => playerRef.current?.setPlaying(playRef.current && !document.hidden);
    update(); document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, [visible, playing, reducedMotion]);
  return <video ref={videoRef} aria-hidden="true" muted playsInline loop preload="none" disablePictureInPicture
    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none', opacity: readyIdentity === identity && !reducedMotion ? 1 : 0 }} />;
}
export default memo(TrackVisual);
