"use client";

import { memo, useRef } from "react";
import GiftIcon from "@/components/gifts/GiftIcon";
import PlayerCsBarButton from "@/components/audio/PlayerCsBarButton";
import {
  HoldSeekButton,
  RepeatButton,
  ShuffleButton,
  TrackTransportButton,
} from "@/components/audio/PlayerControlButton";
import CoverArtCS from "@/components/ui/CoverArtCS";
import SignaturePlayRing from "@/components/player/ImmersivePlayerEngine/SignaturePlayRing";
import { formatPlayerTime } from "@/lib/player/formatTime";
import { PLAYER_LAYOUT_ID } from "@/lib/player/constants";
import { useMediaEngine }    from "@/media/useMediaEngine";
import { useArtworkGesture } from "@/hooks/useArtworkGesture";

function FloatingMainPlayer({
  currentTrack,
  isMobile,
  isSmallScreen,
  coverSize,
  cssVars = {},
  progress,
  currentTime,
  duration,
  isPlaying,
  error,
  accessDenied,
  errorMessage,
  ambientCoverUrl,
  baseCoverUrl,
  baseCoverType,
  csCoverUrl,
  csCoverType,
  csOpacity,
  csMode,
  coverFrameStyle,
  swipeOffset,
  swipeClosing,
  onClose,
  onSeek,
  seek,
  handlePlayToggle,
  playPrevious,
  playNext,
  seekBack,
  seekForward,
  repeatMode,
  toggleRepeat,
  shuffle,
  toggleShuffle,
  hasQueue,
  queueLabel,
  onTouchStart,
  onTouchMove,
  onTouchEnd,
  onCoverTouchStart,
  onCoverTouchMove,
  onCoverTouchEnd,
}) {
  const {
    state: { csMode: engineCsMode },
    toggleCSMode: engineToggleCSMode,
  } = useMediaEngine();
  const showCs = Boolean(currentTrack?.hasCs || currentTrack?.csAudio);

  // Interactive artwork gesture (Slow/Screw/Chop/Filter) on player cover
  const coverRef = useRef(null);
  const { handlers: coverGesture } = useArtworkGesture({
    slug:       currentTrack?.slug || currentTrack?.id || "player",
    elementRef: coverRef,
  });
  const csModeActive = engineCsMode;
  const sourceLabel = String(currentTrack.source || "audio").replace(/_/g, " ");

  return (
    <div
      role="dialog"
      aria-label="Full screen audio player"
      className="audio-immersive-enter player-immersive player-immersive-expanded"
      style={{
        ...cssVars,
        transform: swipeOffset ? `translateY(${swipeOffset}px)` : undefined,
        transition: swipeClosing || swipeOffset === 0 ? "transform 0.22s ease-out" : "none",
      }}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      {(ambientCoverUrl || baseCoverUrl) && (
        <div
          className="player-immersive-expanded__ambient"
          aria-hidden
          style={{ backgroundImage: `url(${ambientCoverUrl || baseCoverUrl})` }}
        />
      )}

      <div className="player-immersive-expanded__content">
        <div className="player-sheet-handle player-immersive-handle" />

        <div className="player-immersive-expanded__header">
          <div className="player-immersive-expanded__label">Now Playing</div>
          <button type="button" className="player-immersive-close-minimal" onClick={onClose} aria-label="Close expanded player">
            <span aria-hidden>×</span>
          </button>
        </div>

        <div className="player-immersive-expanded__stage">
          <div
            ref={coverRef}
            style={{ width: coverSize, height: coverSize, maxWidth: 320, maxHeight: 320 }}
            onPointerDown={coverGesture.onPointerDown}
            onPointerMove={coverGesture.onPointerMove}
            onPointerUp={coverGesture.onPointerUp}
            onPointerCancel={coverGesture.onPointerCancel}
            onLostPointerCapture={coverGesture.onLostPointerCapture}
          >
            <CoverArtCS
              originalSrc={baseCoverUrl}
              originalType={baseCoverType}
              csSrc={csCoverUrl}
              csType={csCoverType}
              csOpacity={csOpacity}
              csMode={csMode}
              width="100%"
              height="100%"
              borderRadius={20}
              className={isPlaying ? "audio-immersive-cover-pulse player-art-glow--playing" : "player-art-glow"}
              style={coverFrameStyle?.(320, 20)}
              onTouchStart={(e) => onCoverTouchStart(e)}
              onTouchMove={onCoverTouchMove}
              onTouchEnd={(e) => onCoverTouchEnd(e)}
              onClick={(e) => e.preventDefault()}
            />
          </div>

          <div className="player-immersive-expanded__meta">
            <div className="player-track-title player-immersive-title player-immersive-title--lg">
              {currentTrack.title}
              {currentTrack?.source === "gift" || currentTrack?.gifted ? (
                <GiftIcon
                  size={12}
                  style={{
                    marginLeft: 4,
                    display: "inline-block",
                    verticalAlign: "middle",
                    animation: "giftIconSpin 4s ease-in-out infinite",
                  }}
                />
              ) : null}
            </div>
            <div className="player-track-meta player-immersive-meta">{currentTrack.artist}</div>
            <div className="player-immersive-expanded__source">{sourceLabel}</div>
          </div>

          <div className="player-immersive-scrub" style={{ width: "100%", maxWidth: 480 }}>
            <div
              className="player-immersive-progress-rail player-immersive-progress-rail--lg"
              onClick={onSeek}
              role="slider"
              aria-valuemin={0}
              aria-valuemax={duration || 0}
              aria-valuenow={currentTime}
              tabIndex={0}
              onKeyDown={(e) => {
                if (!duration || !seek) return;
                if (e.key === "ArrowRight") seek(Math.min(duration, currentTime + 5));
                if (e.key === "ArrowLeft") seek(Math.max(0, currentTime - 5));
              }}
            >
              <div
                className="player-immersive-progress-rail__fill"
                style={{ transform: `scaleX(${progress / 100})`, transformOrigin: "left" }}
                data-error={error ? "1" : undefined}
              />
            </div>
            <div className="player-immersive-scrub__times">
              <span>{formatPlayerTime(currentTime)}</span>
              <span>{formatPlayerTime(duration)}</span>
            </div>
          </div>

          <div className="player-controls-row player-controls-row--primary" style={{ gap: 20, maxWidth: 480, width: "100%" }}>
            {!isSmallScreen ? (
              <TrackTransportButton direction="back" size={44} onClick={() => playPrevious()} />
            ) : (
              <div style={{ width: 44 }} aria-hidden />
            )}
            <HoldSeekButton direction="back" size={44} onTapSeek={() => seekBack(15)} onScrubTick={(s) => seekBack(Math.abs(s))} />
            <SignaturePlayRing
              layoutId={PLAYER_LAYOUT_ID}
              isPlaying={isPlaying}
              hasError={Boolean(error)}
              progress={progress}
              size={72}
              onClick={handlePlayToggle}
            />
            <HoldSeekButton
              direction="forward"
              size={44}
              onTapSeek={() => seekForward(15)}
              onScrubTick={(s) => seekForward(Math.abs(s))}
            />
            {showCs ? (
              <PlayerCsBarButton
                active={csModeActive}
                onClick={() => void engineToggleCSMode?.()}
              />
            ) : null}
            {!isSmallScreen ? (
              <TrackTransportButton direction="forward" size={44} onClick={() => playNext()} />
            ) : (
              <div style={{ width: 44 }} aria-hidden />
            )}
            <ShuffleButton
              active={shuffle}
              size={40}
              onClick={(e) => {
                e.stopPropagation();
                toggleShuffle();
              }}
            />
          </div>

          <div className="player-controls-row" style={{ gap: 20, marginTop: 8 }}>
            <RepeatButton
              repeatMode={repeatMode}
              size={isSmallScreen ? 40 : 44}
              onClick={(e) => {
                e.stopPropagation();
                toggleRepeat();
              }}
            />
          </div>

          {hasQueue && queueLabel ? (
            <div className="player-immersive-queue-label">{queueLabel}</div>
          ) : null}

          {(error || accessDenied) && (
            <div className="player-immersive-error">{errorMessage}</div>
          )}
        </div>
      </div>
    </div>
  );
}

export default memo(FloatingMainPlayer);
