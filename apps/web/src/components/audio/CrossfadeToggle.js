"use client";

import { memo, useEffect, useSyncExternalStore } from 'react';
import {
  getCrossfadeEnabled, getServerCrossfadeEnabled, initializeCrossfadePreference,
  setCrossfadeEnabled, subscribeCrossfade, releaseCrossfadeScope, playlistCrossfadeScope, trackCrossfadeScope,
} from '@/lib/playback/crossfade/preference';

export default memo(function CrossfadeToggle({ release, playlist, track }) {
  const scope = playlist ? playlistCrossfadeScope(playlist) : release ? releaseCrossfadeScope(release) : trackCrossfadeScope(track);
  const enabled = useSyncExternalStore(subscribeCrossfade, () => getCrossfadeEnabled(scope), getServerCrossfadeEnabled);
  useEffect(initializeCrossfadePreference, []);
  return (
    <button
      type="button"
      aria-pressed={enabled}
      aria-label={`${scope ? 'Crossfade for this collection' : 'Default crossfade'} ${enabled ? 'on' : 'off'}`}
      title="Blend the ending into the next track over four seconds"
      onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") event.stopPropagation(); }}
      onClick={(event) => { event.stopPropagation(); setCrossfadeEnabled(!enabled, scope); }}
      className={`player-glass-btn${enabled ? ' player-glass-btn--active' : ''}`}
      style={{ borderRadius: '50%', width: 44, height: 44, padding: 10, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
    >
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
        <path d="M3 6h3c6 0 6 12 12 12h3M3 18h3C12 18 12 6 18 6h3" />
      </svg>
    </button>
  );
});
