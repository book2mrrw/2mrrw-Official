/**
 * Minimal LRC parser — [mm:ss.xx] or [mm:ss] lyric lines.
 */

const LRC_TIME = /\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/g;

export function parseLrc(text) {
  if (!text || typeof text !== "string") return [];
  const lines = [];
  for (const raw of text.split(/\r?\n/)) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const times = [];
    let match;
    LRC_TIME.lastIndex = 0;
    while ((match = LRC_TIME.exec(trimmed)) !== null) {
      const min = Number(match[1]);
      const sec = Number(match[2]);
      const frac = match[3] ? Number(match[3]) / (match[3].length === 3 ? 1000 : 100) : 0;
      times.push(min * 60 + sec + frac);
    }
    const lyric = trimmed.replace(LRC_TIME, "").trim();
    if (!lyric || times.length === 0) continue;
    for (const time of times) {
      lines.push({ time, text: lyric });
    }
  }
  return lines.sort((a, b) => a.time - b.time);
}

export function getActiveLrcIndex(lines, currentTime) {
  if (!lines?.length || !Number.isFinite(currentTime)) return -1;
  let active = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].time <= currentTime + 0.05) active = i;
    else break;
  }
  return active;
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
