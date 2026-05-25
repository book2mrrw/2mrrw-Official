"use client";

import { useMemo, memo, useCallback } from "react";
import SignaturePlayRing from "@/components/player/ImmersivePlayerEngine/SignaturePlayRing";
import { useAudioPlayer } from "@/context/AudioContext";
import { useMediaEngine } from "@/media/useMediaEngine";
import { playerPaletteToCssVars } from "@/lib/player/usePlayerAmbience";
import { formatPlayerTime } from "@/lib/player/formatTime";
import { useRenderTracker } from "@/lib/dev/useRenderTracker";
import { PREVIEW_DISPLAY_CAP_SEC } from "@/components/preview/immersive/constants";

function PreviewPlayerControls({ palette, compact = true, canStream = true }) {
  useRenderTracker("PreviewPlayerControls");
  const {
    state: { isPlaying, currentTime, duration, volume },
    seek,
    toggle,
    setVolume,
  } = useMediaEngine();
  const { isBuffering, error, streamRetryable, retryStreamPlayback } = useAudioPlayer();

  const seekTo = useCallback(
    (e) => {
      if (!displayDuration) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      seek(ratio * displayDuration);
    },
    [displayDuration, seek]
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

  const displayDuration = useMemo(() => {
    if (canStream) return duration;
    if (!duration) return PREVIEW_DISPLAY_CAP_SEC;
    return Math.min(duration, PREVIEW_DISPLAY_CAP_SEC);
  }, [canStream, duration]);

  const progress = displayDuration
    ? Math.max(0, Math.min(100, (currentTime / displayDuration) * 100))
    : 0;
  const playSize = compact ? 52 : 60;
  const cssVars = useMemo(() => playerPaletteToCssVars(palette), [palette]);
  const streamHint = canStream ? "Full stream" : `Preview · ${PREVIEW_DISPLAY_CAP_SEC}s`;

  const handleVolume = useCallback(
    (e) => {
      setVolume(Number(e.target.value));
    },
    [setVolume]
  );

  return (
    <div className="modal-immersive-player modal-immersive-player--accent player-immersive-modal-controls" style={cssVars}>
      <div className="modal-immersive-player__stream-hint" aria-live="polite">
        {streamHint}
      </div>
      <div
        className="player-immersive-progress-rail"
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
        />
        <span className="modal-immersive-player__time modal-immersive-player__time--end">
          {formatPlayerTime(displayDuration)}
        </span>
      </div>
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
    </div>
  );
}

export default memo(PreviewPlayerControls);
