"use client";

import { useMemo, memo, useCallback, useState, useEffect, useRef } from "react";
import SignaturePlayRing from "@/components/player/ImmersivePlayerEngine/SignaturePlayRing";
import { useAudioPlayer } from "@/context/AudioContext";
import { useMediaEngine } from "@/media/useMediaEngine";
import { playerPaletteToCssVars } from "@/lib/player/usePlayerAmbience";
import { formatPlayerTime } from "@/lib/player/formatTime";
import { useRenderTracker } from "@/lib/dev/useRenderTracker";
import { PREVIEW_DISPLAY_CAP_SEC } from "@/components/preview/immersive/constants";

const FLOAT_WAVE_BARS = 20;

function FloatingWaveform({ playing }) {
  return (
    <div
      className={["modal-immersive-waveform", playing ? "is-playing" : ""].filter(Boolean).join(" ")}
      aria-hidden
    >
      {Array.from({ length: FLOAT_WAVE_BARS }, (_, i) => (
        <span key={i} style={{ animationDelay: `${(i % 5) * 0.08}s` }} />
      ))}
    </div>
  );
}

function PreviewPlayerControls({
  palette,
  compact = true,
  variant = "panel",
  canStream = true,
  previewOnly = false,
}) {
  useRenderTracker("PreviewPlayerControls");
  const {
    state: { isPlaying, currentTime, duration, volume },
    seek,
    toggle,
    setVolume,
  } = useMediaEngine();
  const { isBuffering, error, streamRetryable, retryStreamPlayback } = useAudioPlayer();

  const [beat, setBeat] = useState(false);
  const beatRef = useRef(null);

  useEffect(() => {
    if (!isPlaying) {
      setBeat(false);
      return undefined;
    }
    const fire = () => {
      setBeat(true);
      beatRef.current = setTimeout(() => {
        setBeat(false);
        beatRef.current = setTimeout(fire, 380 + Math.random() * 120);
      }, 110);
    };
    beatRef.current = setTimeout(fire, 400);
    return () => {
      if (beatRef.current) clearTimeout(beatRef.current);
    };
  }, [isPlaying]);

  const displayDuration = useMemo(() => {
    if (canStream && !previewOnly) return duration;
    if (!duration) return PREVIEW_DISPLAY_CAP_SEC;
    return Math.min(duration, PREVIEW_DISPLAY_CAP_SEC);
  }, [canStream, duration, previewOnly]);

  const seekTo = useCallback(
    (e) => {
      if (!displayDuration) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const maxSeek = previewOnly ? PREVIEW_DISPLAY_CAP_SEC : displayDuration;
      seek(ratio * maxSeek);
    },
    [displayDuration, previewOnly, seek]
  );

  const togglePlay = useCallback(
    (e) => {
      e?.stopPropagation?.();
      if (streamRetryable && error) {
        void retryStreamPlayback();
        return;
      }
      toggle();
    },
    [error, toggle, retryStreamPlayback, streamRetryable]
  );

  const progress = displayDuration
    ? Math.max(0, Math.min(100, (currentTime / displayDuration) * 100))
    : 0;
  const playSize = compact ? 52 : 60;
  const cssVars = useMemo(() => playerPaletteToCssVars(palette), [palette]);
  const streamHint = canStream && !previewOnly ? "Full stream" : `Preview · ${PREVIEW_DISPLAY_CAP_SEC}s`;
  const isFloating = variant === "floating";

  const handleVolume = useCallback(
    (e) => {
      setVolume(Number(e.target.value));
    },
    [setVolume]
  );

  const rootClass = [
    "modal-immersive-player",
    "modal-immersive-player--accent",
    "player-immersive-modal-controls",
    isFloating ? "modal-immersive-player--floating" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={rootClass} style={cssVars}>
      {isFloating ? <FloatingWaveform playing={isPlaying} /> : null}
      {!isFloating ? (
        <div className="modal-immersive-player__stream-hint" aria-live="polite">
          {streamHint}
        </div>
      ) : null}
      <div
        className="player-immersive-progress-rail modal-immersive-player__rail"
        onClick={seekTo}
        role="slider"
        aria-valuemin={0}
        aria-valuemax={displayDuration || 0}
        aria-valuenow={currentTime}
        tabIndex={0}
      >
        <div
          className="player-immersive-progress-rail__fill"
          style={{ transform: `scaleX(${progress / 100})`, transformOrigin: "left" }}
        />
      </div>
      <div className="modal-immersive-player__row player-immersive-modal-controls__row">
        <span className="modal-immersive-player__time">{formatPlayerTime(currentTime)}</span>
        <SignaturePlayRing
          isPlaying={isPlaying}
          hasError={Boolean(error)}
          isBuffering={isBuffering}
          progress={progress}
          size={playSize}
          layoutId={undefined}
          onClick={togglePlay}
          className={["c-lg", isPlaying ? "playing" : "", beat ? "beat" : ""].filter(Boolean).join(" ")}
        />
        <span className="modal-immersive-player__time modal-immersive-player__time--end">
          {formatPlayerTime(displayDuration)}
        </span>
      </div>
      {!isFloating ? (
        <label className="modal-immersive-player__volume" aria-label="Volume">
          <span className="modal-immersive-player__volume-icon" aria-hidden>
            ♪
          </span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            onChange={handleVolume}
            className="modal-immersive-player__volume-slider"
          />
        </label>
      ) : null}
    </div>
  );
}

export default memo(PreviewPlayerControls);
