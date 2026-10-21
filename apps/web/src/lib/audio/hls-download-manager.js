import { encryptedSegmentStore } from './encrypted-segment-store';
import { bufferedAhead } from './playback-buffer';

export function parseVariants(text, base) {
  const variants = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith('#EXT-X-STREAM-INF:')) continue;
    const bitrate = Number(lines[i].match(/(?:[:,])BANDWIDTH=(\d+)/)?.[1]);
    const uri = lines.slice(i + 1).find(line => line.trim() && !line.startsWith('#'));
    if (bitrate > 0 && uri) variants.push({ bitrate, url: new URL(uri.trim(), base).href });
  }
  return variants.sort((a, b) => b.bitrate - a.bitrate);
}

export function parseEncryptedRendition(text, base) {
  if (!text.includes('#EXT-X-ENDLIST')) throw new Error('Only complete VOD playlists can be warmed');
  const urls = [];
  let encrypted = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('#EXT-X-KEY:')) {
      encrypted = /(?:[:,])METHOD=AES-128(?:,|$)/.test(line) && /URI="[^"]+"/.test(line);
    } else if (line.startsWith('#EXT-X-MAP:')) {
      throw new Error('Unsupported encrypted initialization format');
    } else if (line.startsWith('#EXT-X-BYTERANGE:')) {
      throw new Error('Byte-range warming is unsupported');
    } else if (line && !line.startsWith('#')) {
      if (!encrypted) throw new Error('Only encrypted segments may be retained');
      const url = new URL(line, base);
      if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Unsupported segment URL');
      urls.push(url.href);
    }
  }
  if (!urls.length || urls.length > 1023) throw new Error('Rendition exceeds cache entry budget');
  return urls;
}

/** One opportunistic request at a time. Decoder requests always preempt it.
 * Selected rendition > next opening > highest rendition for a future play.
 */
export class HlsDownloadManager {
  constructor({ store = encryptedSegmentStore, fetcher = (...args) => fetch(...args) } = {}) {
    this.store = store;
    this.fetcher = fetcher;
    this.session = null;
    this.next = null;
    this.foreground = new Set();
    this.pending = null;
    this.timer = null;
    this.running = false;
  }

  begin(audio, selected, highest) {
    this.stop();
    const selectedJob = { url: selected, priority: 0 };
    this.session = { audio, selected: selectedJob,
      high: highest && highest !== selected ? { url: highest, priority: 2 } : null };
    const wake = () => {
      if (!this.healthy()) this.pending?.controller.abort();
      this.schedule();
    };
    const events = ['timeupdate', 'progress', 'playing', 'waiting', 'stalled', 'pause', 'ended'];
    events.forEach(event => audio.addEventListener?.(event, wake));
    this.session.cleanup = () => events.forEach(event => audio.removeEventListener?.(event, wake));
    this.schedule();
    return () => { if (this.session?.selected === selectedJob) this.stop(); };
  }

  healthy() {
    const audio = this.session?.audio;
    const connection = globalThis.navigator?.connection;
    if (!audio || audio.paused || audio.ended || audio.error || audio.readyState < 3) return false;
    if (this.session.selected.done &&
        (connection?.saveData || ['slow-2g', '2g'].includes(connection?.effectiveType))) return false;
    const remaining = audio.duration - audio.currentTime;
    return bufferedAhead(audio) >= Math.min(15, Number.isFinite(remaining) && remaining > 0 ? remaining : 15);
  }

  foregroundStart(owner) {
    this.foreground.add(owner);
    this.pending?.controller.abort();
  }
  foregroundEnd(owner) { this.foreground.delete(owner); this.schedule(); }

  queueNext(masterUrl) {
    if (this.next?.masterUrl === masterUrl) return;
    this.next = { masterUrl, priority: 1, limit: 3 };
    if (this.pending?.job.priority === 2) this.pending.controller.abort();
    this.schedule();
  }

  cancelSpeculation() {
    this.next = null;
    this.pending?.controller.abort();
    this.schedule();
  }

  stop() {
    this.session?.cleanup?.();
    this.session = null;
    this.next = null;
    this.pending?.controller.abort();
    clearTimeout(this.timer);
    this.timer = null;
    this.store.protect();
  }

  schedule() {
    if (!this.session || this.timer || this.running) return;
    this.timer = setTimeout(() => { this.timer = null; void this.tick(); }, 500);
  }

  async request(url, controller) {
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await this.fetcher(url, { credentials: 'same-origin', signal: controller.signal });
      if (!response.ok) throw new Error(`Warm request failed: ${response.status}`);
      // Consume while the deadline is still armed; stalled bodies must abort too.
      const bytes = await response.arrayBuffer();
      if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
      return { bytes, url: response.url || new URL(url, globalThis.location?.href || 'https://2mrrw.com/').href };
    } finally { clearTimeout(timeout); }
  }

  async tick() {
    if (this.running || !this.healthy() || this.foreground.size) return;
    const session = this.session;
    if (session.selected.failed) return;
    const job = [session.selected, this.next, session.high].find(item => item && !item.done && !item.failed);
    if (!job) return;
    const controller = new AbortController();
    this.running = true;
    this.pending = { job, controller };
    const current = () => this.session === session && !controller.signal.aborted;
    try {
      if (!job.url) {
        const result = await this.request(job.masterUrl, controller);
        if (!current()) return;
        job.url = parseVariants(new TextDecoder().decode(result.bytes), result.url)[0]?.url;
        if (!job.url) throw new Error('No variant');
      } else if (!job.urls) {
        const result = await this.request(job.url, controller);
        if (!current()) return;
        job.urls = parseEncryptedRendition(new TextDecoder().decode(result.bytes), result.url);
        if (job.limit) job.urls = job.urls.slice(0, job.limit);
        if (job.priority === 0) this.store.protect(job.urls);
        if (!job.limit) await this.store.remember(job.url, job.urls);
      } else {
        let missing;
        for (const url of job.urls) {
          if (!current()) return;
          if (!await this.store.has(url)) { missing = url; break; }
        }
        if (!missing) {
          if (!job.limit) await this.store.remember(job.url, job.urls);
          job.done = true;
        }
        else {
          const result = await this.request(missing, controller);
          if (!current()) return;
          const retained = await this.store.put(missing, result.bytes);
          // With no persistent storage, the bounded memory layer still helps.
          // Never endlessly redownload a song larger than the storage budget.
          if (!retained && !await this.store.has(missing)) job.failed = true;
          job.downloaded = (job.downloaded || 0) + 1;
          if (job.downloaded > job.urls.length * 2) job.failed = true;
        }
      }
      job.errors = 0;
    } catch {
      if (current()) { job.errors = (job.errors || 0) + 1; if (job.errors >= 3) job.failed = true; }
    } finally {
      this.running = false;
      this.pending = null;
      this.schedule();
    }
  }
}

export const hlsDownloadManager = new HlsDownloadManager();
