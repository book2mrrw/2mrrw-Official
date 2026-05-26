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

function CsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
      <path
        d="M4 6l5 5 5-5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M3 12.5 Q6 11 9 12.5 Q12 14 15 12.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

function SpaceIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M8 8m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <path
        d="M3.5 8a4.5 4.5 0 0 1 9 0"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <path
        d="M1 8a7 7 0 0 1 14 0"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
        opacity=".5"
      />
    </svg>
  );
}

function BassIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M2 10 Q5 6 8 10 Q11 14 14 10"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M2 7 Q5 4 8 7 Q11 10 14 7"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        opacity=".4"
      />
    </svg>
  );
}

function AtmosIcon({ level }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle
        cx="4"
        cy="8"
        r="1.5"
        fill={level >= 1 ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <circle
        cx="8"
        cy="8"
        r="1.5"
        fill={level >= 2 ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <circle
        cx="12"
        cy="8"
        r="1.5"
        fill={level >= 3 ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.2"
      />
    </svg>
  );
}

function FloatingWaveform({ playing, analyser }) {
  const waveformRef = useRef(null);
  const waveRafRef = useRef(null);

  useEffect(() => {
    if (!analyser || !playing) return undefined;
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    const bars = waveformRef.current?.querySelectorAll(".waveform-bar");

    const tick = () => {
      analyser.getByteFrequencyData(dataArray);
      if (bars?.length) {
        bars.forEach((bar, i) => {
          const binIndex = Math.floor((i / bars.length) * (analyser.frequencyBinCount / 2));
          const value = dataArray[binIndex] / 255;
          bar.style.transform = `scaleY(${Math.max(0.08, value)})`;
        });
      }
      waveRafRef.current = requestAnimationFrame(tick);
    };

    tick();
    return () => {
      if (waveRafRef.current) cancelAnimationFrame(waveRafRef.current);
    };
  }, [analyser, playing]);

  return (
    <div
      ref={waveformRef}
      className={["modal-immersive-waveform", playing ? "is-playing" : ""].filter(Boolean).join(" ")}
      aria-hidden
    >
      {Array.from({ length: FLOAT_WAVE_BARS }, (_, i) => (
        <span key={i} className="waveform-bar" style={{ animationDelay: `${(i % 5) * 0.08}s` }} />
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
  track = null,
}) {
  useRenderTracker("PreviewPlayerControls");
  const {
    state: { isPlaying, currentTime, duration, volume, csMode, spaceMode, bassMode, atmosphereLevel },
    seek,
    toggle,
    setVolume,
    toggleCSMode,
    toggleSpaceMode,
    toggleBassBoost,
    cycleAtmosphere,
    analyser,
  } = useMediaEngine();
  const { isBuffering, error, streamRetryable, retryStreamPlayback } = useAudioPlayer();

  const [beat, setBeat] = useState(false);
  const beatRef = useRef(null);
  const lastTapRef = useRef(0);

  const showCs = Boolean(track?.csAudio || track?.hasCs);

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

  const getEventRatio = useCallback((e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clientX =
      e.touches?.[0]?.clientX ?? e.changedTouches?.[0]?.clientX ?? e.clientX;
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  }, []);

  const seekTo = useCallback(
    (e) => {
      if (!displayDuration) return;
      const ratio = getEventRatio(e);
      const maxSeek = previewOnly ? PREVIEW_DISPLAY_CAP_SEC : displayDuration;
      seek(ratio * maxSeek);
    },
    [displayDuration, previewOnly, seek, getEventRatio]
  );

  const togglePlay = useCallback(
    (e) => {
      e?.stopPropagation?.();
      const now = Date.now();
      if (now - lastTapRef.current < 300) return;
      lastTapRef.current = now;
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
      {isFloating ? <FloatingWaveform playing={isPlaying} analyser={analyser} /> : null}
      {!isFloating ? (
        <div className="modal-immersive-player__stream-hint" aria-live="polite">
          {streamHint}
        </div>
      ) : null}
      <div
        className="player-immersive-progress-rail modal-immersive-player__rail"
        onClick={seekTo}
        onTouchEnd={seekTo}
        style={{ touchAction: "none" }}
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
          className={["c-lg", "player-signature-ring", isPlaying ? "playing" : "", beat ? "beat" : ""]
            .filter(Boolean)
            .join(" ")}
        />
        {isFloating && showCs ? (
          <button
            type="button"
            className={`player-cs-btn${csMode ? " player-cs-btn--active" : ""}`}
            onClick={() => void toggleCSMode()}
            title="Chopped & Slowed"
            aria-label="Chopped and slowed mode"
          >
            <CsIcon />
          </button>
        ) : null}
        <span className="modal-immersive-player__time modal-immersive-player__time--end">
          {formatPlayerTime(displayDuration)}
        </span>
      </div>
      {!isFloating ? (
        <div className="modal-immersive-player__transport-row">
          {showCs ? (
            <button
              type="button"
              className={`player-cs-btn${csMode ? " player-cs-btn--active" : ""}`}
              onClick={() => void toggleCSMode()}
              title="Chopped & Slowed"
              aria-label="Chopped and slowed mode"
            >
              <CsIcon />
            </button>
          ) : null}
        </div>
      ) : null}
      {!isFloating ? (
        <div className="player-experience-row">
          <button
            type="button"
            className={`player-exp-btn${spaceMode ? " player-exp-btn--active" : ""}`}
            onClick={() => void toggleSpaceMode()}
            aria-label="Spatial audio mode"
          >
            <SpaceIcon />
          </button>
          <button
            type="button"
            className={`player-exp-btn${bassMode ? " player-exp-btn--active" : ""}`}
            onClick={() => void toggleBassBoost()}
            aria-label="Bass boost"
          >
            <BassIcon />
          </button>
          <button
            type="button"
            className="player-exp-btn player-atmos-btn"
            onClick={cycleAtmosphere}
            aria-label="Atmosphere intensity"
            data-level={atmosphereLevel}
          >
            <AtmosIcon level={atmosphereLevel} />
          </button>
        </div>
      ) : null}
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
