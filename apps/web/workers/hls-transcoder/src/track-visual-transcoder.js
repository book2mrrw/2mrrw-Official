import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { runSourceAnalyzer } from './engine/source-analyzer.js';
import { planTrackVisual, visualEncodeArgs } from './track-visual-policy.js';

// 90 minutes per rendition, raised from 30 after measuring the real worst case on
// the production visual machine (performance-4x, 8gb, 2026-09-30).
//
// Measured: a 30s 4K HDR10 source (bt2020nc/smpte2084) through this exact filter
// chain — scale -> libplacebo tone-map on Mesa lavapipe -> libx264 -preset slow
// -crf 18 — took 846s for 720 frames, i.e. ~1.18s per 3840x2160 frame, at 2.84gb
// peak RSS.
//
// planTrackVisual accepts any frame rate up to 120, and visualEncodeArgs passes it
// straight through as -r, so frame COUNT is what this timeout has to cover:
//
//     30s @  24fps =  720 frames  ~846s   (measured)
//     30s @  60fps = 1800 frames ~2115s   <- exceeded the old 30-minute cap
//     30s @ 120fps = 3600 frames ~4230s   <- the policy's actual ceiling
//
// So the old 30-minute default was not a hang detector for anything above ~40fps
// at 4K — it was a guaranteed SIGKILL on a legitimate upload, and each kill spends
// one of only three attempts before claim_track_visual_job marks the visual failed
// permanently. 90 minutes covers the 120fps ceiling with margin.
//
// Safe to be this long: the worker heartbeats every 30s on an independent interval
// while this runs, so the 5-minute lease never expires mid-encode, and attempt_count
// still caps total retries at 3.
export async function visualFfmpeg(args, { timeoutMs = 90 * 60 * 1000 } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.env.FFMPEG_PATH || 'ffmpeg', args, { stdio: ['ignore','ignore','pipe'] });
    let log = '', timedOut = false;
    const timer = setTimeout(() => { timedOut = true; p.kill('SIGKILL'); }, timeoutMs);
    p.stderr.on('data', b => { log = (log + b).slice(-4096); });
    p.on('error', e => { clearTimeout(timer); reject(e); });
    p.on('close', code => { clearTimeout(timer); code === 0 && !timedOut ? resolve() : reject(new Error(`Visual encode failed: ${log}`)); });
  });
}
export async function transcodeTrackVisual({ job, download, upload, analyze = runSourceAnalyzer, run = visualFfmpeg }) {
  const version = job.version;
  const secret = process.env.TRACK_VISUAL_MASTER_SECRET || process.env.HLS_MASTER_SECRET;
  if (!secret) throw new Error('Visual encryption secret missing');
  const dir = fs.mkdtempSync(path.join(process.env.TRACK_VISUAL_SCRATCH || os.tmpdir(), 'track-visual-'));
  try {
    const sourcePath = path.join(dir,'source');
    await pipeline(await download(version.source_key), fs.createWriteStream(sourcePath), { signal: AbortSignal.timeout(10 * 60 * 1000) });
    if (fs.statSync(sourcePath).size !== Number(version.source_bytes)) throw new Error('Visual upload byte count changed');
    const source = await analyze(sourcePath);
    const plan = planTrackVisual(source);
    const prefix = `track-visuals/renditions/${version.track_id}/${version.id}/${job.lease_token}/`;
    const key = crypto.createHmac('sha256',secret).update(`2mrrw:track-visual:${version.id}:key`).digest().subarray(0,16);
    const iv = crypto.createHmac('sha256',secret).update(`2mrrw:track-visual:${version.id}:iv`).digest().subarray(0,16);
    const keyFile = path.join(dir,'key.bin'); fs.writeFileSync(keyFile,key,{mode:0o600});
    const keyInfo = path.join(dir,'key.txt'); fs.writeFileSync(keyInfo,`placeholder\n${keyFile}\n${iv.toString('hex')}\n`);
    const renditions = [], uploads = [];
    for (const rendition of plan) {
      const outputDir = path.join(dir,rendition.id); fs.mkdirSync(outputDir);
      await run(visualEncodeArgs({sourcePath,outputDir,rendition,keyInfo}));
      const playlistPath = path.join(outputDir,'playlist.m3u8');
      const text = fs.readFileSync(playlistPath,'utf8');
      const durations = [...text.matchAll(/#EXTINF:([\d.]+),/g)].map(m => Number(m[1]));
      const segments = text.split(/\r?\n/).filter(l => /^seg_\d+\.ts$/.test(l));
      if (!text.includes('#EXT-X-ENDLIST') || durations.length !== segments.length || !segments.length) throw new Error('Invalid visual segments');
      const duration = durations.reduce((a,b)=>a+b,0);
      if (Math.abs(duration-source.durationSeconds) > Math.max(0.1,2/source.frameRate)) throw new Error('Visual duration changed');
      const validation = text.replace('URI="placeholder"',`URI="${keyFile}"`);
      const validationPath = path.join(outputDir,'verify.m3u8'); fs.writeFileSync(validationPath,validation);
      // Probe decrypted output, not just the source or encoder arguments.
      const { execFile } = await import('node:child_process');
      const { promisify } = await import('node:util');
      const { stdout } = await promisify(execFile)(process.env.FFPROBE_PATH || 'ffprobe', ['-v','error','-allowed_extensions','ALL','-protocol_whitelist','file,crypto,data','-show_streams','-of','json',validationPath], {timeout:30000,maxBuffer:1024*1024});
      const streams = JSON.parse(stdout).streams || [];
      if (streams.some(s=>s.codec_type==='audio') || !streams.some(s=>s.codec_type==='video' && s.width===rendition.width && s.height===rendition.height)) throw new Error('Output is not the expected silent video');
      await run(['-hide_banner','-loglevel','error','-xerror','-allowed_extensions','ALL','-protocol_whitelist','file,crypto,data','-i',validationPath,'-map','0:v:0','-f','null','-']);
      const sizes = segments.map(name=>fs.statSync(path.join(outputDir,name)).size);
      const video = streams.find(s=>s.codec_type==='video');
      const codecs = `avc1.6400${Number(video.level).toString(16).padStart(2,'0')}`;
      renditions.push({...rendition,codecs,bandwidth:Math.ceil(Math.max(...sizes.map((size,i)=>size*8/durations[i]))),durations,segments,prefix:prefix+rendition.id+'/'});
      for (const name of segments) uploads.push({key:prefix+rendition.id+'/'+name,file:path.join(outputDir,name)});
    }
    // No publication or object upload until every decoded rendition passes.
    for (const item of uploads) await upload(item.key,fs.readFileSync(item.file),'video/mp2t', {CacheControl:'public, max-age=31536000, immutable'});
    return {version:1,assetVersionId:version.id,duration:source.durationSeconds,iv:iv.toString('hex'),renditions};
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
}
