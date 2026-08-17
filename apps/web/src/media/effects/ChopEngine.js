/**
 * ChopEngine — OWNER of Chop/Repeater effect.
 *
 * Mechanism: GainNode automation via Web Audio API's built-in scheduling.
 * Creates a fresh GainNode per burst — no HLS seeking, no element manipulation.
 * NEVER touches the HLS stream. All effect is pure WebAudio graph automation.
 *
 * Gesture input mapping:
 *   nx [0,1] → chop period 50–200ms (left=fast, right=slow)
 *   ny [0,1] → chop gate depth 0.05–0.9 (bottom=subtle, top=hard gate)
 *
 * Burst: 4 chop cycles, then chain extension cleared and IMS notified.
 *
 * Only active during SLOW_LOCKED mode (enforced by IMS.fireChop guard).
 *
 * Registers a fire callback with InteractiveMediaState.
 */

import { getWebAudioEngine } from "@/lib/audio/WebAudioEngine";
import { interactiveMediaState, PERFORMANCE_EFFECT } from "@/media/InteractiveMediaState";

const BURST_CYCLES    = 4;
const PERIOD_MIN_MS   = 50;
const PERIOD_MAX_MS   = 200;
const DEPTH_MIN       = 0.05;   // minimum gain during off phase (never full silence)
const DEPTH_MAX       = 0.90;

function createChopEngine() {
  let _scheduledClearId = null;

  function fire(nx, ny) {
    const engine = getWebAudioEngine();
    const ctx    = engine.ctx;
    if (!ctx) return;

    const periodMs  = PERIOD_MIN_MS + (1 - Math.max(0, Math.min(1, nx))) * (PERIOD_MAX_MS - PERIOD_MIN_MS);
    const depth     = DEPTH_MIN    + Math.max(0, Math.min(1, ny)) * (DEPTH_MAX - DEPTH_MIN);
    const period    = periodMs / 1000;
    const halfPeriod= period / 2;
    const totalDur  = period * BURST_CYCLES;

    // Cancel any pending auto-clear from a previous burst
    if (_scheduledClearId !== null) {
      clearTimeout(_scheduledClearId);
      _scheduledClearId = null;
    }

    // Create a gain node for this burst
    const chopGain = ctx.createGain();
    chopGain.gain.value = 1;

    // Install as chain extension
    engine.setChainExtension([chopGain]);

    // Schedule on/off gate pattern
    const t0 = ctx.currentTime + 0.005; // tiny ramp-in delay
    for (let i = 0; i < BURST_CYCLES; i++) {
      const onTime  = t0 + i * period;
      const offTime = onTime + halfPeriod;
      chopGain.gain.setValueAtTime(1,     onTime);
      chopGain.gain.setValueAtTime(depth, offTime);
    }
    // Return to full gain at end
    chopGain.gain.setValueAtTime(1, t0 + totalDur);

    // Clear after burst completes — but only if CHOP still owns the chain.
    // FilterEngine may have taken ownership during the burst; in that case
    // the stale callback must not tear down the active filter chain.
    _scheduledClearId = setTimeout(() => {
      _scheduledClearId = null;
      if (interactiveMediaState.getSnapshot().performanceEffect !== PERFORMANCE_EFFECT.CHOP) return;
      engine.setChainExtension([]);
      interactiveMediaState.onChopComplete();
    }, (totalDur + 0.05) * 1000);
  }

  /**
   * Immediately cancel any pending teardown timer and remove the Chop GainNode from
   * the WebAudio chain. Called by IMS._clearEffect() on track change or effect collision
   * so the chopGain never lingers as a silent pass-through after the burst owner changes.
   *
   * AudioParam events already scheduled on the audio thread are NOT cancelled — they
   * execute harmlessly against the disconnected node and the gain settles to 1.0.
   * AudioContext.currentTime continues advancing regardless of HTMLMediaElement.pause()
   * state, so the events always complete on the audio thread timeline.
   */
  function clear() {
    if (_scheduledClearId !== null) {
      clearTimeout(_scheduledClearId);
      _scheduledClearId = null;
    }
    engine.setChainExtension([]);
  }

  // Register with IMS
  interactiveMediaState.registerChopCallbacks({ fire, clear });

  return { fire };
}

export const chopEngine = createChopEngine();
