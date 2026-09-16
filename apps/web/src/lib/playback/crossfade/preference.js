// Deliberately separate from the provider/transport store. A toggle only notifies
// its controls and the optional transition owner, never the whole player tree.
const KEY = '2mrrw_song_crossfade_v1';
let enabled = false;
let initialized = false;
const listeners = new Set();

export function initializeCrossfadePreference() {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;
  try { enabled = window.localStorage.getItem(KEY) === '1'; } catch {}
  listeners.forEach((listener) => listener());
}

export const getCrossfadeEnabled = () => enabled;
export const getServerCrossfadeEnabled = () => false;
export function subscribeCrossfade(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function setCrossfadeEnabled(value) {
  initializeCrossfadePreference();
  const next = Boolean(value);
  if (enabled === next) return;
  enabled = next;
  try { window.localStorage.setItem(KEY, enabled ? '1' : '0'); } catch {}
  listeners.forEach((listener) => listener());
}
