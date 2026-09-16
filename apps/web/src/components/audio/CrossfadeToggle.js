"use client";

import { memo, useEffect, useSyncExternalStore } from 'react';
import {
  getCrossfadeEnabled, getServerCrossfadeEnabled, initializeCrossfadePreference,
  setCrossfadeEnabled, subscribeCrossfade,
} from '@/lib/playback/crossfade/preference';

export default memo(function CrossfadeToggle() {
  const enabled = useSyncExternalStore(subscribeCrossfade, getCrossfadeEnabled, getServerCrossfadeEnabled);
  useEffect(initializeCrossfadePreference, []);
  return (
    <button
      type="button"
      aria-pressed={enabled}
      aria-label={`Crossfade ${enabled ? 'on' : 'off'}`}
      title="Blend the ending into the next track over four seconds"
      onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") event.stopPropagation(); }}
      onClick={(event) => { event.stopPropagation(); setCrossfadeEnabled(!enabled); }}
      className={`player-glass-btn${enabled ? ' player-glass-btn--active' : ''}`}
      style={{ borderRadius: 22, padding: '7px 12px', minHeight: 36, fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}
    >
      Crossfade · {enabled ? 'On' : 'Off'}
    </button>
  );
});
