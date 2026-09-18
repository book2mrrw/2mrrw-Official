// Preference subscriptions are independent of player/provider rendering.
const KEY = '2mrrw_song_crossfade_v2';
const LEGACY_KEY = '2mrrw_song_crossfade_v1';
let enabled = false;
let overrides = new Map();
let initialized = false;
const listeners = new Set();
const notify = () => listeners.forEach((listener) => listener());

export function releaseCrossfadeScope(release) {
  const id = release?.slug || release?.id;
  return id ? `release:${id}` : null;
}
export function playlistCrossfadeScope(playlist) {
  return playlist?.id ? `playlist:${playlist.id}` : null;
}
export function trackCrossfadeScope(track) {
  if (track?.metadata?.playlistId) return `playlist:${track.metadata.playlistId}`;
  if (track?.source === 'playlist') return null;
  const id = track?.metadata?.albumSlug || track?.albumSlug;
  return id ? `release:${id}` : null;
}
export function initializeCrossfadePreference() {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;
  try {
    const saved = window.localStorage.getItem(KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      enabled = parsed.default === true;
      overrides = new Map(Object.entries(parsed.overrides || {}).filter(([key, value]) =>
        /^(release|playlist):.{1,300}$/.test(key) && typeof value === 'boolean').slice(-1000));
    } else enabled = window.localStorage.getItem(LEGACY_KEY) === '1';
  } catch { /* Storage failure must never interrupt playback. */ }
  notify();
}
export const getCrossfadeEnabled = (scope = null) => scope && overrides.has(scope) ? overrides.get(scope) : enabled;
export const hasEnabledCrossfade = () => enabled || [...overrides.values()].some(Boolean);
export const getServerCrossfadeEnabled = () => false;
export function subscribeCrossfade(listener) { listeners.add(listener); return () => listeners.delete(listener); }
export function setCrossfadeEnabled(value, scope = null) {
  initializeCrossfadePreference();
  const next = Boolean(value);
  if (scope) {
    if (overrides.get(scope) === next) return;
    overrides.delete(scope);
    overrides.set(scope, next);
    if (overrides.size > 1000) overrides.delete(overrides.keys().next().value);
  } else {
    if (enabled === next) return;
    enabled = next;
  }
  try { window.localStorage.setItem(KEY, JSON.stringify({ default: enabled, overrides: Object.fromEntries(overrides) })); } catch {}
  notify();
}
