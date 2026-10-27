/**
 * ScrewEngine — OWNER of real-time Slow/Screw audio effect.
 *
 * Mechanism: sets `playbackRate` on the live HTMLAudioElement with `preservesPitch=false`
 * so the pitch drops with the speed, producing the classic screwed sound.
 *
 * This is NOT csMode (which loads a separate pre-processed audio file).
 * These two systems are completely independent.
 *
 * Rate mapping:
 *   intensity=0 → playbackRate=0.85 (subtle screw)
 *   intensity=1 → playbackRate=0.65 (deep screw)
 *
 * Registers callbacks with InteractiveMediaState so IMS dispatches through here.
 */

import { getWebAudioEngine } from "@/lib/audio/WebAudioEngine";
import { interactiveMediaState } from "@/media/InteractiveMediaState";

const RATE_MIN    = 0.65;   // deepest screw (intensity=1)
const RATE_MAX    = 0.85;   // lightest screw (intensity=0)

function intensityToRate(intensity) {
  const clamped = Math.max(0, Math.min(1, intensity));
  return RATE_MAX + (RATE_MIN - RATE_MAX) * clamped;
}

function createScrewEngine() {
  let _active = false;

  function activate(intensity) {
    _active = true;
    const engine = getWebAudioEngine();
    engine.setScrewPlaybackRate(intensityToRate(intensity));
  }

  function deactivate() {
    if (!_active) return;
    _active = false;
    const engine = getWebAudioEngine();
    engine.setScrewPlaybackRate(null);
  }

  function setIntensity(intensity) {
    if (!_active) return;
    getWebAudioEngine().setScrewPlaybackRate(intensityToRate(intensity));
  }

  // Register with IMS so it can dispatch through us.
  interactiveMediaState.registerScrewCallbacks({ activate, deactivate, setIntensity });

  return { activate, deactivate, setIntensity };
}

export const screwEngine = createScrewEngine();
