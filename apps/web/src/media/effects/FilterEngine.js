/**
 * FilterEngine — OWNER of musical lowpass filter effect.
 *
 * Mechanism: BiquadFilterNode (lowpass) inserted into the WebAudio chain
 * via WebAudioEngine.setChainExtension(). Parameters are smoothed with
 * linearRampToValueAtTime to prevent zipper noise.
 *
 * Gesture input mapping:
 *   nx [0,1] → cutoff frequency 200–18000 Hz (log scale)
 *   ny [0,1] → Q (resonance) 0.5–12
 *
 * Deactivation: ramps cutoff to 20000 Hz over 120ms, then clears chain extension.
 *
 * Active only during SLOW_LOCKED mode (enforced by IMS.setFilterXY guard).
 * Only one effect (CHOP or FILTER) can be active at a time — IMS enforces this.
 *
 * Registers setXY + deactivate callbacks with InteractiveMediaState.
 */

import { getWebAudioEngine } from "@/lib/audio/WebAudioEngine";
import { interactiveMediaState, PERFORMANCE_EFFECT } from "@/media/InteractiveMediaState";

const FREQ_MIN  = 200;      // Hz — bottom of sweep
const FREQ_MAX  = 18000;    // Hz — top of sweep
const Q_MIN     = 0.5;
const Q_MAX     = 12;
const RAMP_MS   = 40;       // parameter smoothing ramp
const DEACT_MS  = 120;      // deactivation ramp to fully open

function logFreq(nx) {
  const clamped = Math.max(0, Math.min(1, nx));
  return FREQ_MIN * Math.pow(FREQ_MAX / FREQ_MIN, clamped);
}

function createFilterEngine() {
  let _filter   = null;
  let _lastCtx  = null;
  let _deactTimer = null;
  let _active   = false;

  function _ensureFilter() {
    const engine = getWebAudioEngine();
    const ctx    = engine.ctx;
    if (!ctx) return null;
    if (_filter && _lastCtx === ctx) return _filter;
    // Context changed or first call — create new node
    const f = ctx.createBiquadFilter();
    f.type            = "lowpass";
    f.frequency.value = FREQ_MAX;
    f.Q.value         = Q_MIN;
    _filter  = f;
    _lastCtx = ctx;
    return f;
  }

  function setXY(nx, ny) {
    const engine = getWebAudioEngine();
    const ctx    = engine.ctx;
    if (!ctx) return;

    const f = _ensureFilter();
    if (!f) return;

    // Cancel any pending deactivation
    if (_deactTimer !== null) {
      clearTimeout(_deactTimer);
      _deactTimer = null;
    }

    if (!_active) {
      // First activation — install in chain
      engine.setChainExtension([f]);
      _active = true;
    }

    const targetFreq = logFreq(nx);
    const targetQ    = Q_MIN + Math.max(0, Math.min(1, ny)) * (Q_MAX - Q_MIN);
    const rampEnd    = ctx.currentTime + RAMP_MS / 1000;

    f.frequency.linearRampToValueAtTime(targetFreq, rampEnd);
    f.Q.linearRampToValueAtTime(targetQ, rampEnd);
  }

  function deactivate() {
    if (!_active) return;
    const engine = getWebAudioEngine();
    const ctx    = engine.ctx;
    if (!ctx || !_filter || _lastCtx !== ctx) {
      // Context gone — just clear
      engine.setChainExtension([]);
      _active = false;
      return;
    }

    // Ramp filter fully open, then clear
    const rampEnd = ctx.currentTime + DEACT_MS / 1000;
    _filter.frequency.linearRampToValueAtTime(FREQ_MAX, rampEnd);
    _filter.Q.linearRampToValueAtTime(Q_MIN, rampEnd);

    _deactTimer = setTimeout(() => {
      _deactTimer = null;
      _active = false;
      // Only clear if CHOP has not taken chain ownership during the deactivation ramp.
      // Clearing while CHOP is active would destroy its GainNode extension.
      if (interactiveMediaState.getSnapshot().performanceEffect !== PERFORMANCE_EFFECT.CHOP) {
        engine.setChainExtension([]);
      }
    }, DEACT_MS + 20);
  }

  // Register with IMS
  interactiveMediaState.registerFilterCallbacks({ setXY, deactivate });

  return { setXY, deactivate };
}

export const filterEngine = createFilterEngine();
