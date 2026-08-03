import React, { createContext, useContext, useEffect, useState } from 'react';
import TrackPlayer from 'react-native-track-player';
import { setupAudioEngine } from './AudioEngine';
import { usePlaybackStore } from '@/stores/playback-store';

interface AudioContextValue {
  ready: boolean;
}

const AudioContext = createContext<AudioContextValue>({ ready: false });

export function AudioProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let mounted = true;
    setupAudioEngine()
      .then(() => { if (mounted) setReady(true); })
      .catch((err) => {
        // Player may already be set up on hot-reload
        if (String(err).includes('already been initialized') && mounted) {
          setReady(true);
        }
      });
    return () => { mounted = false; };
  }, []);

  return (
    <AudioContext.Provider value={{ ready }}>
      {children}
    </AudioContext.Provider>
  );
}

export const useAudio = () => useContext(AudioContext);
