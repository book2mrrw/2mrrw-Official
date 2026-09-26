import { spawn } from 'node:child_process';

export const TRUE_PEAK_CEILING_DBTP = -1;
// AAC peaks need not decrease monotonically with input gain. Production
// catalog verification required a fourth measured pass; retain a finite
// budget without weakening the decoded-output publication gate.
export const MAX_HEADROOM_PASSES = 6;

/** Bounded logs and runtime; errors never qualify a rendition for publication. */
export function runAudioFfmpeg(args, { binary = process.env.FFMPEG_PATH || 'ffmpeg', timeoutMs = 30 * 60 * 1000 } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(binary, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '', timedOut = false;
    const timer = setTimeout(() => { timedOut = true; proc.kill('SIGKILL'); }, timeoutMs);
    proc.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-65536); });
    proc.once('error', error => { clearTimeout(timer); reject(error); });
    proc.once('close', code => {
      clearTimeout(timer);
      if (timedOut || code !== 0) reject(new Error(`Audio FFmpeg ${timedOut ? 'timed out' : `exited ${code}`}: ${stderr.slice(-2000)}`));
      else resolve(stderr);
    });
  });
}

export function parseTruePeak(stderr) {
  const summary = stderr.slice(stderr.lastIndexOf('Summary:'));
  const match = summary.match(/True peak:\s*Peak:\s*(-?(?:\d+(?:\.\d+)?|inf)) dBFS/);
  if (!match) throw new Error('Missing decoded true-peak measurement');
  if (match[1] === '-inf') return -Infinity;
  const peak = Number(match[1]);
  if (!Number.isFinite(peak)) throw new Error('Invalid true-peak measurement');
  return peak;
}

export async function measureTruePeak(input, { encrypted = false, ...options } = {}) {
  const stderr = await runAudioFfmpeg(['-hide_banner', '-nostats', '-xerror',
    ...(encrypted ? ['-allowed_extensions', 'ALL', '-protocol_whitelist', 'file,crypto,data'] : []),
    '-i', input, '-map', '0:a:0', '-af', 'ebur128=peak=true', '-f', 'null', '-'], options);
  return parseTruePeak(stderr);
}

export function initialHeadroomGain(sourcePeak) {
  if (sourcePeak === -Infinity) return 0;
  if (!Number.isFinite(sourcePeak)) throw new Error('Invalid source peak');
  // One extra dB is an initial codec allowance, not a guarantee; outputs are verified.
  return Math.min(0, TRUE_PEAK_CEILING_DBTP - 1 - sourcePeak);
}

export function nextHeadroomGain(gain, peaks) {
  if (!peaks.length || peaks.some(p => p !== -Infinity && !Number.isFinite(p))) throw new Error('Invalid rendition peaks');
  const worst = Math.max(...peaks);
  // FFmpeg summary rounds to 0.1 dB: require another 0.1 dB below the ceiling.
  if (worst <= TRUE_PEAK_CEILING_DBTP - 0.1) return null;
  return gain - (worst - TRUE_PEAK_CEILING_DBTP + 0.2);
}
