import { View, Text, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { usePlaybackStore } from '@/stores/playback-store';
import { formatDuration } from '@2mrrw/core';
import { colors } from '@2mrrw/design-system';
import type { CatalogTrack } from '@2mrrw/types';

interface Props {
  track: CatalogTrack;
  index: number;
  allTracks: CatalogTrack[];
}

export function TrackRow({ track, index, allTracks }: Props) {
  const { currentTrack, isPlaying, play, playQueue } = usePlaybackStore();
  const isActive = currentTrack?.id === track.id;

  const handlePress = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    playQueue(allTracks as any, index);
  };

  return (
    <Pressable
      onPress={handlePress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(255,255,255,0.05)',
      }}
    >
      {/* Track number or playing indicator */}
      <View style={{ width: 28, alignItems: 'center' }}>
        {isActive ? (
          <Ionicons
            name={isPlaying ? 'pause' : 'play'}
            size={14}
            color={colors.accent.primary}
          />
        ) : (
          <Text
            style={{
              color: colors.text.muted,
              fontFamily: 'DMMono',
              fontSize: 11,
            }}
          >
            {(track.trackNumber ?? index + 1).toString().padStart(2, '0')}
          </Text>
        )}
      </View>

      {/* Title & duration */}
      <View style={{ flex: 1, marginLeft: 8 }}>
        <Text
          numberOfLines={1}
          style={{
            color: isActive ? colors.accent.primary : colors.foreground.dark,
            fontFamily: 'Outfit',
            fontSize: 14,
            fontWeight: isActive ? '600' : '400',
          }}
        >
          {track.title}
        </Text>
      </View>

      <Text
        style={{
          color: colors.text.muted,
          fontFamily: 'DMMono',
          fontSize: 11,
          marginLeft: 8,
        }}
      >
        {track.duration ? formatDuration(track.duration) : ''}
      </Text>
    </Pressable>
  );
}
