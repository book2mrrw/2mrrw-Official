"use client";

import { useMemo, memo, useCallback } from "react";
import SignaturePlayRing from "@/components/player/ImmersivePlayerEngine/SignaturePlayRing";
import { useImmersivePlayback } from "@/lib/player/useImmersivePlayback";
import { playerPaletteToCssVars } from "@/lib/player/usePlayerAmbience";
import { formatPlayerTime } from "@/lib/player/formatTime";
import { useRenderTracker } from "@/lib/dev/useRenderTracker";

function PreviewPlayerControls({ palette, compact = true }) {
  useRenderTracker("PreviewPlayerControls");
  const {
    isPlaying,
    isBuffering,
    currentTime,
    duration,
    error,
    streamRetryable,
    handlePlayToggle,
    seek,
    retryStreamPlayback,
  } = useImmersivePlayback();

  const seekTo = useCallback(
    (e) => {
      if (!duration) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      seek(ratio * duration);
    },
    [duration, seek]
  );

  const togglePlay = useCallback(
    (e) => {
      if (streamRetryable && error) {
        void retryStreamPlayback();
        return;
      }
      handlePlayToggle(e);
    },
    [error, handlePlayToggle, retryStreamPlayback, streamRetryable]
  );

  const progress = duration ? Math.max(0, Math.min(100, (currentTime / duration) * 100)) : 0;
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
