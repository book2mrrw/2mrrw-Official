import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Video, ResizeMode } from 'expo-av';
import { Image } from 'expo-image';
import type { CatalogRelease } from '@2mrrw/types';

interface Props {
  release: CatalogRelease;
  width: number | `${number}%`;
  height: number;
  borderRadius?: number;
  active?: boolean;
}

export function ReleaseArtwork({
  release,
  width,
  height,
  borderRadius = 0,
  active = true,
}: Props) {
  const [videoReady, setVideoReady] = useState(false);
  const [videoFailed, setVideoFailed] = useState(false);
  const hasVideo = release.coverArtType === 'video' && Boolean(release.video);

  return (
    <View style={{ width, height, borderRadius, overflow: 'hidden' }}>
      <Image
        source={{ uri: release.baseCover ?? release.cover ?? undefined }}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        transition={0}
      />
      {hasVideo && !videoFailed ? (
        <Video
          source={{ uri: release.video! }}
          style={[StyleSheet.absoluteFill, { opacity: videoReady ? 1 : 0 }]}
          resizeMode={ResizeMode.COVER}
          shouldPlay={active}
          isLooping
          isMuted
          useNativeControls={false}
          onReadyForDisplay={() => setVideoReady(true)}
          onError={() => setVideoFailed(true)}
        />
      ) : null}
    </View>
  );
}
