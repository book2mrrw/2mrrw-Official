/** Track-loop policy. No imports from audio, playback, or Audio Visualz owners. */
export function planTrackVisual(source) {
  if (!Number.isFinite(source.durationSeconds) || source.durationSeconds < 7 || source.durationSeconds > 30) throw new Error('Visual must be between 7 and 30 seconds');
  if (!(source.frameRate > 0 && source.frameRate <= 120)) throw new Error('Unsupported visual frame rate');
  let width = source.width, height = source.height;
  if (Math.abs(source.rotationDegrees || 0) % 180 === 90) [width, height] = [height, width];
  if (!(width > 0 && height > 0 && width <= 16384 && height <= 16384)) throw new Error('Invalid visual dimensions');
  const longSide = Math.max(width, height);
  const sizes = [...new Set([Math.min(longSide, 3840), ...[1920, 1280, 854].filter(n => n < longSide)])];
  return sizes.map(edge => ({
    id: String(edge), width: Math.max(2, Math.floor(width * edge / longSide / 2) * 2),
    height: Math.max(2, Math.floor(height * edge / longSide / 2) * 2),
    frameRate: source.frameRate, hdr: source.hdrMode !== 'sdr',
  }));
}
export function visualEncodeArgs({ sourcePath, outputDir, rendition, keyInfo }) {
  const { width, height, frameRate, hdr } = rendition;
  const filters = [`scale=${width}:${height}`, ...(hdr ? ['libplacebo=tonemapping=bt.2390:colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=tv:format=yuv420p'] : []), 'setsar=1'];
  return ['-hide_banner','-loglevel','error','-y', ...(hdr ? ['-init_hw_device','vulkan=tv0','-filter_hw_device','tv0'] : []),
    '-i',sourcePath,'-map','0:v:0','-an','-sn','-dn','-vf',filters.join(','),
    '-c:v','libx264','-preset','slow','-crf','18','-pix_fmt','yuv420p','-profile:v','high',
    '-r',String(frameRate),'-g',String(Math.round(frameRate * 2)),'-keyint_min',String(Math.round(frameRate * 2)),
    '-sc_threshold','0','-force_key_frames','expr:gte(t,n_forced*2)',
    '-f','hls','-hls_time','2','-hls_playlist_type','vod','-hls_flags','independent_segments',
    '-hls_key_info_file',keyInfo,'-hls_segment_filename',`${outputDir}/seg_%05d.ts`,`${outputDir}/playlist.m3u8`];
}
