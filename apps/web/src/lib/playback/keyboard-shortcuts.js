/**
 * Document-level playback keyboard shortcuts.
 *
 * Standard streaming-platform bindings:
 *   Space         — play / pause
 *   ←             — seek back 10 s
 *   →             — seek forward 10 s
 *   Shift + ←     — previous track
 *   Shift + →     — next track
 *   M             — toggle mute (restores last non-zero volume)
 *   ↑             — volume +5 %
 *   ↓             — volume −5 %
 *
 * Guards:
 *   - Ignored when focus is inside an <input>, <textarea>, <select>, or [contenteditable].
 *   - Ignored when a modifier key other than Shift is held (preserves browser/OS shortcuts).
 *   - preventDefault only on keys that would otherwise scroll the page (Space, arrows).
 */

import { dispatchPlaybackCommand } from "./command-dispatcher";
import { PLAYBACK_COMMANDS } from "./playback-commands";
import { getWebAudioEngine } from "@/lib/audio/WebAudioEngine";
import { getAudioEngineRuntime } from "./audio-engine-runtime";
import { getProductionPlaybackCore } from "@/lib/playback-core/production/wireProductionCore";

const INTERACTIVE_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT", "BUTTON"]);

function isFocusedOnInput() {
  const el = document.activeElement;
  if (!el) return false;
  if (INTERACTIVE_TAGS.has(el.tagName)) return true;
  if (el.isContentEditable) return true;
  return false;
}

function getAudioElement() {
  return getAudioEngineRuntime().refs.audioRef.current;
}

let _muteVolume = null; // saved volume before mute

function handleKey(e) {
  // Ignore if modifier keys other than Shift are held.
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  // Ignore when typing in a form field.
  if (isFocusedOnInput()) return;

  const audio = getAudioElement();
  const engine = getWebAudioEngine();
  const playbackCore = getProductionPlaybackCore();

  switch (e.code) {
    case "Space": {
      e.preventDefault();
      if (!audio) return;
      if (audio.paused) {
        playbackCore.port.resume();
        engine.resumeSync();
      } else {
        playbackCore.port.pause();
      }
      break;
    }

    case "ArrowLeft": {
      e.preventDefault();
      if (!audio) return;
      if (e.shiftKey) {
        void dispatchPlaybackCommand(
          PLAYBACK_COMMANDS.PREV_TRACK,
          {},
          { serial: false, cancelActiveStream: true },
        );
      } else {
        const next = Math.max(0, (audio.currentTime || 0) - 10);
        playbackCore.port.seek({ positionSeconds: next });
      }
      break;
    }

    case "ArrowRight": {
      e.preventDefault();
      if (!audio) return;
      if (e.shiftKey) {
        void dispatchPlaybackCommand(
          PLAYBACK_COMMANDS.NEXT_TRACK,
          {},
          { serial: false, cancelActiveStream: true },
        );
      } else {
        const dur = isFinite(audio.duration) ? audio.duration : 0;
        const next = Math.min(dur, (audio.currentTime || 0) + 10);
        playbackCore.port.seek({ positionSeconds: next });
      }
      break;
    }

    case "KeyM": {
      if (e.shiftKey) return; // leave Shift+M free
      if (!audio) return;
      if (audio.volume > 0) {
        _muteVolume = audio.volume;
        engine.setUserVolume(0);
      } else {
        engine.setUserVolume(_muteVolume ?? 1);
        _muteVolume = null;
      }
      break;
    }

    case "ArrowUp": {
      e.preventDefault();
      if (!audio) return;
      engine.setUserVolume(Math.min(1, engine.getUserVolume() + 0.05));
      break;
    }

    case "ArrowDown": {
      e.preventDefault();
      if (!audio) return;
      engine.setUserVolume(Math.max(0, engine.getUserVolume() - 0.05));
      break;
    }

    default:
      break;
  }
}

let _registered = false;

/**
 * Register global playback keyboard shortcuts.
 * Safe to call multiple times — only one listener is ever attached.
 * @returns {() => void} cleanup that removes the listener
 */
export function registerPlaybackKeyboardShortcuts() {
  if (typeof document === "undefined") return () => {};
  if (_registered) return () => {};
  _registered = true;
  document.addEventListener("keydown", handleKey, { capture: false });
  return () => {
    document.removeEventListener("keydown", handleKey, { capture: false });
    _registered = false;
  };
}
