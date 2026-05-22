"use client";

import { useEffect, useState, memo } from "react";

const formatTime = (s) => {
  if (!s || isNaN(s) || !isFinite(s)) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
};

function PreviewModalPlayer({ audioRef, compact }) {
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
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

  const seekTo = (e) => {
    const audio = audioRef.current;
    if (!audio || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    audio.currentTime = ratio * duration;
  };

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) audio.pause();
    else audio.play().catch(() => {});
  };

  const btnSize = compact ? 40 : 44;

  return (
    <div style={{ width: "100%" }}>
      <div
        onClick={seekTo}
        style={{
          width: "100%",
          height: 4,
          background: "#1e1e1e",
          borderRadius: 3,
          cursor: "pointer",
          marginBottom: compact ? 6 : 8,
          position: "relative",
        }}
      >
        <div
          style={{
            width: duration ? `${(current / duration) * 100}%` : "0%",
            height: "100%",
            background: "#00ffff",
            borderRadius: 3,
            transition: "width 0.1s linear",
            boxShadow: "0 0 6px rgba(0,255,255,0.5)",
          }}
        />
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <span style={{ fontSize: 10, color: "#555", fontVariantNumeric: "tabular-nums", minWidth: 32 }}>
          {formatTime(current)}
        </span>
        <button
          type="button"
          onClick={togglePlay}
          style={{
            width: btnSize,
            height: btnSize,
            borderRadius: "50%",
            background: "#00ffff",
            border: "none",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            flexShrink: 0,
            boxShadow: "0 0 16px rgba(0,255,255,0.4)",
          }}
        >
          {playing ? (
            <svg viewBox="0 0 24 24" fill="#000" width="16" height="16">
              <path d="M6 19h4V5H6zm8-14v14h4V5z" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="#000" width="16" height="16" style={{ marginLeft: 2 }}>
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>
        <span
          style={{
            fontSize: 10,
            color: "#555",
            fontVariantNumeric: "tabular-nums",
            minWidth: 32,
            textAlign: "right",
          }}
        >
          {formatTime(duration)}
        </span>
      </div>
    </div>
  );
}

export default memo(PreviewModalPlayer);
