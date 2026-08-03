const VAULT_AUDIO_ASSETS = {
  lockClick: "/audio/vault/lock-click.mp3",
  hydraulicRelease: "/audio/vault/hydraulic-release.mp3",
  doorGrind: "/audio/vault/door-grind.mp3",
  vaultThunk: "/audio/vault/vault-thunk.mp3",
  ambientHum: "/audio/vault/ambient-hum.mp3",
  hoverHeartbeat: "/audio/vault/hover-heartbeat.mp3",
};

const VOLUMES = {
  lockClick: 0.18,
  hydraulicRelease: 0.14,
  doorGrind: 0.12,
  vaultThunk: 0.18,
  ambientHum: 0.035,
  hoverHeartbeat: 0.045,
};

const OPEN_SEQUENCE = [
  { sound: "lockClick", delay: 0 },
  { sound: "hydraulicRelease", delay: 80 },
  { sound: "doorGrind", delay: 150 },
  { sound: "vaultThunk", delay: 1600, fallback: "thunk" },
];

class VaultAudioController {
  constructor() {
    this.assets = VAULT_AUDIO_ASSETS;
    this.audio = new Map();
    this.available = new Map();
    this.checked = false;
    this.preloading = null;
    this.unlocked = false;
    this.ctx = null;
    this.master = null;
    this.panner = null;
    this.ambientFallback = null;
    this.heartbeatFallback = null;
    this.timers = new Set();
    this.sequenceUntil = 0;
  }

  async init() {
    if (typeof window === "undefined") return false;

    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass && !this.ctx) {
        this.ctx = new AudioContextClass();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.16;
        this.panner = typeof this.ctx.createStereoPanner === "function" ? this.ctx.createStereoPanner() : null;
        if (this.panner) {
          this.panner.pan.value = -0.04;
          this.master.connect(this.panner);
          this.panner.connect(this.ctx.destination);
        } else {
          this.master.connect(this.ctx.destination);
        }
      }

      if (this.ctx?.state === "suspended") await this.ctx.resume();
      this.unlocked = true;
      void this.preload();
      return true;
    } catch {
      return false;
    }
  }

  async preload() {
    if (typeof window === "undefined") return;
    if (this.preloading) return this.preloading;

    this.preloading = this.detectAssets().then(() => {
      Object.entries(this.assets).forEach(([key, src]) => {
        if (!this.available.get(key) || this.audio.has(key)) return;
        try {
          const sound = new Audio(src);
          sound.preload = "auto";
          sound.volume = VOLUMES[key] || 0.08;
          sound.loop = key === "ambientHum" || key === "hoverHeartbeat";
          this.audio.set(key, sound);
        } catch {}
      });
    }).catch(() => {});

    return this.preloading;
  }

  async detectAssets() {
    if (this.checked || typeof fetch !== "function") return;

    await Promise.all(Object.entries(this.assets).map(async ([key, src]) => {
      try {
        const response = await fetch(src, { method: "HEAD", cache: "force-cache" });
        this.available.set(key, response.ok);
      } catch {
        this.available.set(key, false);
      }
    }));
    this.checked = true;
  }

  playOpenSequence() {
    void this.init().then((ready) => {
      const now = Date.now();
      if (!ready || now < this.sequenceUntil) return;
      this.sequenceUntil = now + 1850;
      this.stopAmbient();
      this.clearTimers();

      OPEN_SEQUENCE.forEach(({ sound, delay, fallback }) => {
        this.schedule(() => {
          if (!this.playSound(sound)) this.playFallback(fallback || sound);
        }, delay);
      });
    });
  }

  startAmbient() {
    if (!this.unlocked) return;
    void this.init().then((ready) => {
      if (!ready) return;
      if (this.playLoop("ambientHum")) return;
      this.startAmbientFallback();
    });
  }

  stopAmbient() {
    this.stopLoop("ambientHum");
    this.stopAmbientFallback();
  }

  startHeartbeat() {
    if (!this.unlocked) return;
    void this.init().then((ready) => {
      if (!ready) return;
      if (this.playLoop("hoverHeartbeat")) return;
      this.startHeartbeatFallback();
    });
  }

  stopHeartbeat() {
    this.stopLoop("hoverHeartbeat");
    this.stopHeartbeatFallback();
  }

  cleanup() {
    this.clearTimers();
    this.stopAmbient();
    this.stopHeartbeat();
    this.audio.forEach(sound => {
      try {
        sound.pause();
        sound.currentTime = 0;
      } catch {}
    });
  }

  getAssetStatus() {
    return Object.fromEntries(Object.keys(this.assets).map(key => [key, Boolean(this.available.get(key))]));
  }

  playSound(key) {
    const sound = this.audio.get(key);
    if (!sound) return false;

    try {
      sound.pause();
      sound.currentTime = 0;
      sound.volume = VOLUMES[key] || sound.volume;
      const playPromise = sound.play();
      if (playPromise?.catch) playPromise.catch(() => {});
      return true;
    } catch {
      return false;
    }
  }

  playLoop(key) {
    const sound = this.audio.get(key);
    if (!sound || !sound.paused) return Boolean(sound);

    try {
      sound.loop = true;
      sound.currentTime = 0;
      sound.volume = VOLUMES[key] || sound.volume;
      const playPromise = sound.play();
      if (playPromise?.catch) playPromise.catch(() => {});
      return true;
    } catch {
      return false;
    }
  }

  stopLoop(key) {
    const sound = this.audio.get(key);
    if (!sound) return;

    try {
      sound.pause();
      sound.currentTime = 0;
    } catch {}
  }

  schedule(callback, delay) {
    const timer = window.setTimeout(() => {
      this.timers.delete(timer);
      callback();
    }, delay);
    this.timers.add(timer);
  }

  clearTimers() {
    this.timers.forEach(timer => window.clearTimeout(timer));
    this.timers.clear();
  }

  startAmbientFallback() {
    if (!this.ctx || !this.master || this.ambientFallback) return;

    try {
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.0001, this.ctx.currentTime);
      gain.gain.setTargetAtTime(0.01, this.ctx.currentTime + 0.02, 0.8);
      gain.connect(this.master);

      const low = this.ctx.createOscillator();
      low.type = "sine";
      low.frequency.value = 42;
      const overtone = this.ctx.createOscillator();
      overtone.type = "triangle";
      overtone.frequency.value = 84;
      overtone.detune.value = -6;
      low.connect(gain);
      overtone.connect(gain);
      low.start();
      overtone.start();
      this.ambientFallback = { gain, oscillators: [low, overtone] };
    } catch {
      this.ambientFallback = null;
    }
  }

  stopAmbientFallback() {
    if (!this.ambientFallback || !this.ctx) return;

    try {
      const now = this.ctx.currentTime;
      this.ambientFallback.gain.gain.cancelScheduledValues(now);
      this.ambientFallback.gain.gain.setTargetAtTime(0.0001, now, 0.18);
      this.ambientFallback.oscillators.forEach(osc => osc.stop(now + 0.45));
    } catch {}
    this.ambientFallback = null;
  }

  startHeartbeatFallback() {
    if (!this.ctx || !this.master || this.heartbeatFallback) return;

    const tick = () => {
      this.playFallback("heartbeat");
      this.heartbeatFallback.timer = window.setTimeout(tick, 1180);
    };
    this.heartbeatFallback = { timer: window.setTimeout(tick, 120) };
  }

  stopHeartbeatFallback() {
    if (!this.heartbeatFallback) return;
    window.clearTimeout(this.heartbeatFallback.timer);
    this.heartbeatFallback = null;
  }

  playFallback(kind) {
    if (!this.ctx || !this.master || this.ctx.state !== "running") return;

    try {
      if (kind === "hydraulicRelease") {
        this.playNoiseSweep(0.24);
        return;
      }
      if (kind === "doorGrind") {
        this.tone({ duration: 1.34, frequency: 48, endFrequency: 38, type: "sawtooth", volume: 0.008 });
        this.tone({ delay: 0.08, duration: 1.18, frequency: 91, endFrequency: 64, type: "triangle", volume: 0.006 });
        return;
      }
      if (kind === "heartbeat") {
        this.tone({ duration: 0.09, frequency: 54, endFrequency: 42, type: "sine", volume: 0.012 });
        this.tone({ delay: 0.16, duration: 0.08, frequency: 48, endFrequency: 38, type: "sine", volume: 0.009 });
        return;
      }
      if (kind === "thunk") {
        this.tone({ duration: 0.2, frequency: 64, endFrequency: 34, type: "triangle", volume: 0.019 });
        return;
      }
      this.tone({ duration: 0.045, frequency: 118, endFrequency: 72, type: "square", volume: 0.014 });
    } catch {}
  }

  tone({ delay = 0, duration = 0.12, frequency = 80, endFrequency, type = "sine", volume = 0.012 }) {
    const start = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, start);
    if (endFrequency) osc.frequency.exponentialRampToValueAtTime(endFrequency, start + duration);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(Math.max(volume, 0.0002), start + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(start);
    osc.stop(start + duration + 0.04);
  }

  playNoiseSweep(duration = 0.24) {
    const sampleRate = this.ctx.sampleRate;
    const buffer = this.ctx.createBuffer(1, Math.max(1, Math.floor(sampleRate * duration)), sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    }

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(260, this.ctx.currentTime);
    filter.frequency.exponentialRampToValueAtTime(82, this.ctx.currentTime + duration);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.018, this.ctx.currentTime + 0.035);
    gain.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    source.start();
  }
}

export const vaultAudioController = new VaultAudioController();
export { VAULT_AUDIO_ASSETS };
