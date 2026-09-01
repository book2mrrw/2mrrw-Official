/**
 * Canonical browser media-priority authority.
 *
 * Audio startup is latency-sensitive. Muted artwork loops are decorative and
 * must yield before the first manifest/segment request, then remain suspended
 * while audio owns the foreground media path. A generation-bound lease keeps
 * superseded play requests from releasing a newer request's authority.
 */

const DEFAULT_STARTUP_LEASE_TIMEOUT_MS = 30_000;

export function createAudioMediaPriorityCoordinator({
  schedule = (callback, delay) => setTimeout(callback, delay),
  cancel = (timer) => clearTimeout(timer),
  startupLeaseTimeoutMs = DEFAULT_STARTUP_LEASE_TIMEOUT_MS,
} = {}) {
  const listeners = new Set();
  let generation = 0;
  let startupActive = false;
  let playbackActive = false;
  let snapshot = Object.freeze({
    active: false,
    startupActive: false,
    playbackActive: false,
    generation: 0,
  });

  const publish = () => {
    const active = startupActive || playbackActive;
    if (
      snapshot.active === active &&
      snapshot.startupActive === startupActive &&
      snapshot.playbackActive === playbackActive &&
      snapshot.generation === generation
    ) {
      return;
    }
    snapshot = Object.freeze({ active, startupActive, playbackActive, generation });
    listeners.forEach((listener) => {
      try {
        listener();
      } catch {
        // One visual surface must never prevent the others from yielding.
      }
    });
  };

  const setPlaybackActive = (nextActive) => {
    const normalized = Boolean(nextActive);
    if (playbackActive === normalized) return;
    playbackActive = normalized;
    publish();
  };

  const beginStartup = () => {
    generation += 1;
    const leaseGeneration = generation;
    startupActive = true;
    publish();

    let released = false;
    const timeout = schedule(() => {
      release();
    }, startupLeaseTimeoutMs);

    function release() {
      if (released) return false;
      released = true;
      cancel(timeout);
      if (leaseGeneration !== generation) return false;
      startupActive = false;
      publish();
      return true;
    }

    function promoteToPlayback() {
      if (released || leaseGeneration !== generation) return false;
      startupActive = false;
      playbackActive = true;
      publish();
      return true;
    }

    return Object.freeze({ generation: leaseGeneration, promoteToPlayback, release });
  };

  return Object.freeze({
    beginStartup,
    getSnapshot: () => snapshot,
    getServerSnapshot: () => snapshot,
    setPlaybackActive,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });
}

export const audioMediaPriority = createAudioMediaPriorityCoordinator();

let browserSignalInstalled = false;

function installBrowserPlaybackSignal() {
  if (browserSignalInstalled || typeof window === "undefined") return;
  browserSignalInstalled = true;
  window.addEventListener("2mrrw:playback-active-changed", (event) => {
    audioMediaPriority.setPlaybackActive(event.detail?.isPlaying);
  });
}

export function beginAudioStartupPriority() {
  installBrowserPlaybackSignal();
  return audioMediaPriority.beginStartup();
}

export function subscribeAudioMediaPriority(listener) {
  installBrowserPlaybackSignal();
  return audioMediaPriority.subscribe(listener);
}

export function getAudioMediaPrioritySnapshot() {
  return audioMediaPriority.getSnapshot();
}

export function getAudioMediaPriorityServerSnapshot() {
  return audioMediaPriority.getServerSnapshot();
}
