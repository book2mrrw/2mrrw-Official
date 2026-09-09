import { isSamePlaybackTrack } from "@/lib/music-playback";

/** A section owns its full playable queue, including on an explicit restart. */
export function playSectionQueue({ items, clickedItem, source, bridge, toTrack }) {
  const tracks = (items || []).map(toTrack).filter((track) => track?.src);
  const index = tracks.findIndex((track) => track.slug === clickedItem?.slug);
  if (index < 0 || !bridge) return false;
  const sameQueue = bridge.queue?.length === tracks.length &&
    tracks.every((track, i) => isSamePlaybackTrack(track, bridge.queue[i]) && bridge.queue[i]?.source === source);
  const completed = ["idle", "ended", "ended_preview"].includes(bridge.playbackState);
  if (sameQueue && !completed && isSamePlaybackTrack(bridge.currentTrack, tracks[index])) {
    bridge.toggle?.();
    return true;
  }
  bridge.playQueue?.(tracks, index, { resumeAt: 0, autoAdvance: true });
  return true;
}
