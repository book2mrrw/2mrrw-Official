"use client";

import { useEffect, useState, memo, useCallback, useMemo } from "react";
import SignaturePlayRing from "@/components/player/ImmersivePlayerEngine/SignaturePlayRing";
import { playerPaletteToCssVars } from "@/lib/player/usePlayerAmbience";
import { formatPlayerTime } from "@/lib/player/formatTime";

function PreviewPlayerControls({ audioRef, palette, compact = true }) {
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return undefined;

    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onTime = () => setCurrent(audio.currentTime);
    const onDuration = () => setDuration(isFinite(audio.duration) ? audio.duration : 0);
    const onEnded = () => {
      setPlaying(false);
      setCurrent(0);
    };
    const onLoaded = () => setDuration(isFinite(audio.duration) ? audio.duration : 0);

    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("durationchange", onDuration);
    audio.addEventListener("loadedmetadata", onLoaded);
    audio.addEventListener("ended", onEnded);

    if (!audio.paused) setPlaying(true);
    if (isFinite(audio.duration)) setDuration(audio.duration);

    return () => {
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("durationchange", onDuration);
      audio.removeEventListener("loadedmetadata", onLoaded);
      audio.removeEventListener("ended", onEnded);
    };
  }, [audioRef]);

  const seekTo = useCallback(
    (e) => {
      const audio = audioRef.current;
      if (!audio || !duration) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      audio.currentTime = ratio * duration;
    },
    [audioRef, duration]
  );

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) audio.pause();
    else audio.play().catch(() => {});
  }, [audioRef, playing]);

  const progress = duration ? Math.max(0, Math.min(100, (current / duration) * 100)) : 0;
  const playSize = compact ? 52 : 60;
  const cssVars = useMemo(() => playerPaletteToCssVars(palette), [palette]);

  return (
    <div className="modal-immersive-player modal-immersive-player--accent player-immersive-modal-controls" style={cssVars}>
      <div
        className="player-immersive-progress-rail"
        onClick={seekTo}
        role="slider"
        aria-valuemin={0}
        aria-valuemax={duration || 0}
        aria-valuenow={current}
        tabIndex={0}
      >
        <div className="player-immersive-progress-rail__fill" style={{ width: `${progress}%` }} />
      </div>
      <div className="modal-immersive-player__row player-immersive-modal-controls__row">
        <span className="modal-immersive-player__time">{formatPlayerTime(current)}</span>
        <SignaturePlayRing
          isPlaying={playing}
          hasError={false}
          progress={progress}
          size={playSize}
          onClick={togglePlay}
        />
        <span className="modal-immersive-player__time modal-immersive-player__time--end">
          {formatPlayerTime(duration)}
        </span>
      </div>
    </div>
  );
}

export default memo(PreviewPlayerControls);
