/** Measure the actual encrypted transport files using RFC 8216 section 4.1. */
export function measureAudioRendition(playlist, sizeOf) {
  const target = Number(playlist.match(/^#EXT-X-TARGETDURATION:(\d+)\s*$/m)?.[1]);
  if (!Number.isSafeInteger(target) || target <= 0 || !playlist.includes('#EXT-X-ENDLIST')) throw new Error('Invalid completed audio playlist');
  const segments = [];
  let duration = null;
  for (const raw of playlist.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('#EXTINF:')) {
      if (duration !== null) throw new Error('Missing segment URI');
      duration = Number(line.slice(8).split(',')[0]);
      if (!Number.isFinite(duration) || duration <= 0 || Math.round(duration) > target) throw new Error('Invalid segment duration');
    } else if (line && !line.startsWith('#')) {
      if (duration === null || !/^seg_\d+\.ts$/.test(line)) throw new Error('Invalid audio segment URI');
      const bytes = sizeOf(line);
      if (!Number.isSafeInteger(bytes) || bytes <= 0) throw new Error('Missing or empty audio segment');
      segments.push({name:line,duration,bytes});
      duration = null;
    }
  }
  if (duration !== null || !segments.length || new Set(segments.map(s=>s.name)).size !== segments.length) throw new Error('Incomplete audio segments');
  let peak = 0;
  for (let i=0;i<segments.length;i++) {
    let seconds=0, bytes=0;
    for (let j=i;j<segments.length;j++) {
      seconds += segments[j].duration; bytes += segments[j].bytes;
      if (seconds > 1.5*target) break;
      if (seconds >= 0.5*target) peak = Math.max(peak,8*bytes/seconds);
    }
  }
  const seconds = segments.reduce((n,s)=>n+s.duration,0);
  const average = segments.reduce((n,s)=>n+s.bytes,0)*8/seconds;
  // A very short clip may have no qualifying RFC window; use its whole duration.
  return {segments, metadata:{version:1, target_duration:target,
    segment_durations:segments.map(s=>s.duration),
    bandwidth:Math.ceil(peak || average), average_bandwidth:Math.ceil(average)}};
}
