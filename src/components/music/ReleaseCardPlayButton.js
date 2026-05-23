"use client";

import { useCallback } from "react";
import { useAudioPlayer } from "@/context/AudioContext";
import { toPlaybackTrack } from "@/lib/music-playback";

export default function ReleaseCardPlayButton({ item, accountState, userId, source = "home_card", onPlayClick }) {
  const { playQueue, toggle, currentTrack, isPlaying, hasStarted } = useAudioPlayer();

  const handlePlay = useCallback(
    (e) => {
      e.stopPropagation();
      if (onPlayClick) {
        onPlayClick(e, item);
        return;
      }
      const track = toPlaybackTrack(item, { ...accountState, userId }, source);
      if (!track.src) return;
      const sameTrack =
        hasStarted &&
        (currentTrack?.slug === track.slug || currentTrack?.id === track.id);
      if (sameTrack) {
        void toggle();
        return;
      }
      void playQueue([track], 0);
    },
    [accountState, currentTrack?.id, currentTrack?.slug, hasStarted, item, onPlayClick, playQueue, source, toggle, userId]
  );

  const sameTrack =
    hasStarted &&
    currentTrack &&
    (currentTrack.slug === item?.slug || currentTrack.id === item?.slug);
  const showPause = sameTrack && isPlaying;

  return (
    <button
      type="button"
      aria-label={showPause ? "Pause" : "Play preview"}
      onClick={handlePlay}
      style={{
        width: 44,
        height: 44,
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#111",
        border: "1px solid #333",
        borderRadius: 10,
        cursor: "pointer",
        padding: 0,
      }}
    >
      <span style={{ color: "#00ffff", fontSize: 16, lineHeight: 1 }}>{showPause ? "⏸" : "▶"}</span>
    </button>
  );
}

export function ReleaseCardActions({ item, accountState, userId, source, onAddToCart, onPlayClick, cartButtonStyle, cartLabel = "+ Cart" }) {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <ReleaseCardPlayButton item={item} accountState={accountState} userId={userId} source={source} onPlayClick={onPlayClick} />
      <button
        type="button"
        onClick={onAddToCart}
        style={{
          flex: 1,
          height: 44,
          padding: "7px 0",
          fontSize: 11,
          fontWeight: 600,
          cursor: "pointer",
          borderRadius: 7,
          transition: "0.2s",
          ...cartButtonStyle,
        }}
      >
        {cartLabel}
      </button>
    </div>
  );
}
