/** Owns only its dedicated silent video element. No music transport dependency. */
export class TrackVisualPlayer {
  constructor(video, { loadHls = () => import('hls.js').then(m => m.default), onReady = () => {}, onFailure = () => {} } = {}) {
    this.video = video; this.loadHls = loadHls; this.onReady = onReady; this.onFailure = onFailure;
    this.destroyed = false; this.wantsPlay = false; this.hls = null;
    video.muted = true; video.defaultMuted = true; video.volume = 0; video.loop = true; video.playsInline = true;
    this.ready = () => { if (!this.destroyed) this.onReady(); };
    this.failed = () => { if (!this.destroyed) { this.setPlaying(false); this.hls?.destroy(); this.hls = null; this.onFailure(); } };
    video.addEventListener('loadeddata', this.ready);
    video.addEventListener('error', this.failed);
  }
  async load(url) {
    if (this.destroyed) return;
    if (this.video.canPlayType('application/vnd.apple.mpegurl')) {
      this.video.src = url; this.applyPlayback(); return;
    }
    try {
      const Hls = await this.loadHls();
      if (this.destroyed) return;
      if (!Hls.isSupported()) { this.failed(); return; }
      const hls = this.hls = new Hls({
        autoStartLoad: false, capLevelToPlayerSize: true, maxBufferLength: 8,
        maxMaxBufferLength: 30, backBufferLength: 0, maxBufferSize: 24 * 1024 * 1024,
        enableWorker: true, startLevel: -1,
      });
      hls.on(Hls.Events.ERROR, (_, data) => { if (data.fatal) this.failed(); });
      hls.on(Hls.Events.MEDIA_ATTACHED, () => { if (!this.destroyed) { hls.loadSource(url); this.applyPlayback(); } });
      hls.attachMedia(this.video);
    } catch { this.failed(); }
  }
  applyPlayback() {
    if (this.destroyed) return;
    if (this.wantsPlay) {
      this.hls?.startLoad(-1);
      this.video.play()?.catch(() => { /* Muted autoplay denied: retain artwork. */ });
    } else {
      this.video.pause(); this.hls?.stopLoad();
    }
  }
  setPlaying(value) {
    const next = Boolean(value);
    if (next === this.wantsPlay) return;
    this.wantsPlay = next; this.applyPlayback();
  }
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.video.removeEventListener('loadeddata', this.ready);
    this.video.removeEventListener('error', this.failed);
    this.hls?.destroy(); this.hls = null;
    this.video.pause(); this.video.removeAttribute('src'); this.video.load();
  }
}
