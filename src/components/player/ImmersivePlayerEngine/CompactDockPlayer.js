"use client";

import { memo } from "react";
import GiftIcon from "@/components/gifts/GiftIcon";
import CSModeButton from "@/components/audio/CSModeButton";
import {
  ClosePlayerButton,
  RepeatButton,
  ShuffleButton,
  TrackTransportButton,
} from "@/components/audio/PlayerControlButton";
import SignaturePlayRing from "@/components/player/ImmersivePlayerEngine/SignaturePlayRing";
import PlayerArtwork from "@/components/player/ImmersivePlayerEngine/PlayerArtwork";
import { formatPlayerTime } from "@/lib/player/formatTime";

function CompactDockPlayer({
  currentTrack,
  isMobile,
  cssVars = {},
  progress,
  currentTime,
  duration,
  isPlaying,
  error,
  accessDenied,
  errorMessage,
  csOpacity,
  csMode,
  baseCoverUrl,
  baseCoverType,
  csCoverUrl,
  csCoverType,
  coverFrameStyle,
  onExpand,
  onStop,
  onSeekBarClick,
  handlePlayToggle,
  playPrevious,
  playNext,
  repeatMode,
  toggleRepeat,
  shuffle,
  toggleShuffle,
  onCoverTouchStart,
  onCoverTouchMove,
  onCoverTouchEnd,
  showSecondaryRow = true,
}) {
  const giftBadge =
    currentTrack?.source === "gift" || currentTrack?.gifted ? (
      <GiftIcon
        size={12}
        style={{
          marginLeft: 4,
          display: "inline-block",
          verticalAlign: "middle",
          animation: "giftIconSpin 4s ease-in-out infinite",
        }}
      />
    ) : null;

  const metaLine =
    error || accessDenied
      ? errorMessage
      : `${currentTrack.artist} · ${formatPlayerTime(currentTime)} / ${formatPlayerTime(duration)}`;

  return (
    <div
      role="region"
      aria-label="Global audio player"
      className="player-dock player-immersive-glass"
      style={cssVars}
    >
      <div
        className="player-immersive-progress-rail"
        onClick={onSeekBarClick}
        role="slider"
        aria-valuemin={0}
        aria-valuemax={duration || 0}
        aria-valuenow={currentTime}
        tabIndex={0}
      >
        <div
          className="player-immersive-progress-rail__fill"
          style={{ transform: `scaleX(${progress / 100})`, transformOrigin: "left" }}
          data-error={error ? "1" : undefined}
        />
      </div>
      <div
        className="player-dock-inner player-immersive-dock-inner"
        style={{ maxWidth: 1180, margin: "0 auto", padding: isMobile ? "10px 14px 12px" : "12px 20px" }}
      >
        <div className="player-immersive-dock-row">
          <PlayerArtwork
            baseCoverUrl={baseCoverUrl}
            baseCoverType={baseCoverType}
            csCoverUrl={csCoverUrl}
            csCoverType={csCoverType}
            csOpacity={csOpacity}
            csMode={csMode}
            size={isMobile ? 52 : 56}
            borderRadius={isMobile ? 10 : 12}
            isPlaying={isPlaying}
            style={coverFrameStyle?.(isMobile ? 52 : 56, isMobile ? 10 : 12)}
            role="button"
            tabIndex={0}
            aria-label="Cover art"
            onTouchStart={(e) => onCoverTouchStart(e, onExpand)}
            onTouchMove={onCoverTouchMove}
            onTouchEnd={(e) => onCoverTouchEnd(e, onExpand)}
            onClick={(e) => e.preventDefault()}
          />
          <button type="button" className="player-immersive-meta-btn" onClick={onExpand} aria-label="Expand player">
            <div className="player-track-title player-immersive-title">
              {currentTrack.title}
              {giftBadge}
            </div>
            <div
              className="player-track-meta player-immersive-meta"
              data-error={error || accessDenied ? "1" : undefined}
            >
              {metaLine}
            </div>
          </button>
          <TrackTransportButton direction="back" size={isMobile ? 32 : 34} onClick={() => playPrevious()} />
          <SignaturePlayRing
            isPlaying={isPlaying}
            hasError={Boolean(error)}
            progress={progress}
            size={isMobile ? 50 : 54}
            onClick={handlePlayToggle}
            className="player-immersive-dock-ring"
          />
          <TrackTransportButton direction="forward" size={isMobile ? 32 : 34} onClick={() => playNext()} />
          <ClosePlayerButton onClick={onStop} size={18} />
        </div>
        {showSecondaryRow ? (
          <div className="player-immersive-dock-secondary">
            <RepeatButton
              repeatMode={repeatMode}
              size={isMobile ? 34 : 36}
              onClick={(e) => {
                e.stopPropagation();
                toggleRepeat();
              }}
            />
            <CSModeButton />
            <ShuffleButton
              active={shuffle}
              size={isMobile ? 34 : 36}
              onClick={(e) => {
                e.stopPropagation();
                toggleShuffle();
              }}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default memo(CompactDockPlayer);
