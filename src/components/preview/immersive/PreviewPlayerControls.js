"use client";

import { useEffect, useState, memo, useCallback } from "react";
import { PlayPauseHero } from "@/components/audio/PlayerControlButton";
import { paletteToCssVars } from "@/hooks/useCoverPalette";

const formatTime = (s) => {
  if (!s || isNaN(s) || !isFinite(s)) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
};

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
  const playSize = compact ? 48 : 56;
  const cssVars = paletteToCssVars(palette);

  return (
    <div className="modal-immersive-player modal-immersive-player--accent" style={cssVars}>
      <div
        className="modal-immersive-player__track"
        onClick={seekTo}
        role="slider"
        aria-valuemin={0}
        aria-valuemax={duration || 0}
        aria-valuenow={current}
        tabIndex={0}
      >
        <div className="modal-immersive-player__fill" style={{ width: `${progress}%` }} />
      </div>
      <div className="modal-immersive-player__row">
        <span className="modal-immersive-player__time">{formatTime(current)}</span>
        <PlayPauseHero isPlaying={playing} hasError={false} size={playSize} onClick={togglePlay} />
        <span className="modal-immersive-player__time modal-immersive-player__time--end">
          {formatTime(duration)}
        </span>
      </div>
    </div>
  );
}

export default memo(PreviewPlayerControls);
