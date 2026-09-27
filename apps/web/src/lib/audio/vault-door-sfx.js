"use client";

/**
 * Synthesized vault-door audio.
 *
 * apps/web/public/audio/vault/README.md reserves real recordings for this
 * (lock-click / hydraulic-release / door-grind / vault-thunk) and states the
 * fallback when those files are absent: "subtle Web Audio synthesis or
 * no-ops silently when playback is blocked." No recordings exist yet, so
 * this is that fallback -- built from oscillators and filtered noise rather
 * than shipping an audio file, which also means it costs no download and
 * can be retuned by editing numbers.
 *
 * Only ever called from a real user gesture (the unlock hold completing),
 * which is what satisfies browser autoplay policy; every call is wrapped so
 * a blocked or unsupported context degrades to silence instead of throwing
 * into the interaction.
 */

let ctx = null;

function getContext() {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  // One context reused across plays -- browsers cap how many can exist, and
  // an unused one parks itself in "suspended" costing nothing.
  if (!ctx || ctx.state === "closed") {
    try { ctx = new Ctor(); } catch { return null; }
  }
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}

function noiseBuffer(ac, seconds) {
  const frames = Math.max(1, Math.floor(ac.sampleRate * seconds));
  const buf = ac.createBuffer(1, frames, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < frames; i += 1) data[i] = Math.random() * 2 - 1;
  return buf;
}

/** Low, short mechanical impact -- the bolts releasing, and later seating. */
function thud(ac, out, at, freq, gain, length) {
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(freq * 1.8, at);
  osc.frequency.exponentialRampToValueAtTime(freq, at + length * 0.6);
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(gain, at + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, at + length);
  osc.connect(g).connect(out);
  osc.start(at);
  osc.stop(at + length + 0.05);
}

/** Broadband transient stacked on a thud so it reads as metal, not a drum. */
function click(ac, out, at, gain) {
  const src = ac.createBufferSource();
  src.buffer = noiseBuffer(ac, 0.12);
  const bp = ac.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.setValueAtTime(2600, at);
  bp.Q.value = 1.1;
  const g = ac.createGain();
  g.gain.setValueAtTime(gain, at);
  g.gain.exponentialRampToValueAtTime(0.0001, at + 0.11);
  src.connect(bp).connect(g).connect(out);
  src.start(at);
  src.stop(at + 0.13);
}

export function playVaultDoorOpen() {
  const ac = getContext();
  if (!ac) return;
  try {
    const t = ac.currentTime + 0.02;
    const master = ac.createGain();
    master.gain.value = 0.34;
    master.connect(ac.destination);

    // 1. bolts release
    thud(ac, master, t, 68, 0.55, 0.42);
    click(ac, master, t + 0.01, 0.16);

    // 2. servo drive -- the doors actually moving, pitch creeping up as the
    //    mass gets going, then easing off as it reaches the stop
    const servo = ac.createOscillator();
    const servoGain = ac.createGain();
    const servoLp = ac.createBiquadFilter();
    servo.type = "sawtooth";
    servoLp.type = "lowpass";
    servoLp.frequency.setValueAtTime(420, t);
    servoLp.frequency.linearRampToValueAtTime(900, t + 1.4);
    servoLp.frequency.linearRampToValueAtTime(500, t + 2.3);
    servo.frequency.setValueAtTime(84, t + 0.12);
    servo.frequency.linearRampToValueAtTime(158, t + 1.5);
    servo.frequency.linearRampToValueAtTime(132, t + 2.25);
    servoGain.gain.setValueAtTime(0.0001, t + 0.12);
    servoGain.gain.exponentialRampToValueAtTime(0.10, t + 0.5);
    servoGain.gain.setValueAtTime(0.10, t + 1.7);
    servoGain.gain.exponentialRampToValueAtTime(0.0001, t + 2.35);
    servo.connect(servoLp).connect(servoGain).connect(master);
    servo.start(t + 0.1);
    servo.stop(t + 2.45);

    // 3. pneumatic release, brightest at the crack and fading as it vents
    const air = ac.createBufferSource();
    air.buffer = noiseBuffer(ac, 1.6);
    const airBp = ac.createBiquadFilter();
    airBp.type = "bandpass";
    airBp.Q.value = 0.8;
    airBp.frequency.setValueAtTime(3200, t + 0.16);
    airBp.frequency.exponentialRampToValueAtTime(700, t + 1.5);
    const airGain = ac.createGain();
    airGain.gain.setValueAtTime(0.0001, t + 0.16);
    airGain.gain.exponentialRampToValueAtTime(0.085, t + 0.32);
    airGain.gain.exponentialRampToValueAtTime(0.0001, t + 1.55);
    air.connect(airBp).connect(airGain).connect(master);
    air.start(t + 0.15);
    air.stop(t + 1.7);

    // 4. the weight of it -- sub rumble under everything while it travels
    const rumble = ac.createOscillator();
    const rumbleGain = ac.createGain();
    rumble.type = "sine";
    rumble.frequency.setValueAtTime(44, t + 0.08);
    rumble.frequency.linearRampToValueAtTime(38, t + 2.2);
    rumbleGain.gain.setValueAtTime(0.0001, t + 0.08);
    rumbleGain.gain.exponentialRampToValueAtTime(0.22, t + 0.6);
    rumbleGain.gain.exponentialRampToValueAtTime(0.0001, t + 2.4);
    rumble.connect(rumbleGain).connect(master);
    rumble.start(t + 0.06);
    rumble.stop(t + 2.5);

    // 5. doors reach the stop
    thud(ac, master, t + 2.28, 52, 0.42, 0.55);
    click(ac, master, t + 2.29, 0.09);
  } catch {
    /* audio is a nicety -- never let it break the unlock */
  }
}
