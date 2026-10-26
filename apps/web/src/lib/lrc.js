/**
 * Minimal LRC parser — [mm:ss.xx] or [mm:ss] lyric lines.
 */

import { decodeLyrics, activeLyricIndex } from './lyrics/timing.js';

export function parseLrc(text) {
  const {lines} = decodeLyrics(text);
  const timed = lines.filter(l => l.time != null);
  return (timed.length ? timed.sort((a,b)=>a.time-b.time) : lines).map(({time,text,words})=>({time,text,...(words?{words}:{})}));
}

export function getActiveLrcIndex(lines, currentTime, options) {
  return activeLyricIndex(lines, currentTime, options);
}

export function extractLrcFromRelease(release) {
  if (!release) return "";
  const track = Array.isArray(release.tracks) ? release.tracks[0] : null;
  return (
    track?.lyricsLrc ||
    track?.lyrics_lrc ||
    track?.lrc ||
    release?.lyricsLrc ||
    release?.lyrics_lrc ||
    release?.lrc ||
    ""
  );
}
