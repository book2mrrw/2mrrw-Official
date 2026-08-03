import { View, Text, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePlaybackStore } from '@/stores/playback-store';
import { colors } from '@2mrrw/design-system';

export function MiniPlayer() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { currentTrack, isPlaying, pause, resume } = usePlaybackStore();

  if (!currentTrack) return null;

  const handlePlayPause = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (isPlaying) {
      await pause();
    } else {
      await resume();
    }
  };

  // Sits above the tab bar
  const bottomOffset = insets.bottom + 56 + 8;

  return (
    <Pressable
      onPress={() => router.push('/player')}
      style={{
        position: 'absolute',
        bottom: bottomOffset,
        left: 12,
        right: 12,
        backgroundColor: '#1a1a1a',
        borderRadius: 14,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.08)',
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 12,
        paddingVertical: 10,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.4,
        shadowRadius: 12,
        elevation: 8,
      }}
    >
      {/* Artwork */}
      <Image
        source={{ uri: currentTrack.cover ?? undefined }}
        style={{ width: 42, height: 42, borderRadius: 8 }}
        contentFit="cover"
      />

      {/* Track info */}
      <View style={{ flex: 1, marginLeft: 10, marginRight: 8 }}>
        <Text
          numberOfLines={1}
          style={{
            color: colors.foreground.dark,
            fontFamily: 'Outfit',
            fontSize: 14,
            fontWeight: '500',
          }}
        >
          {currentTrack.title}
        </Text>
        <Text
          numberOfLines={1}
          style={{
            color: colors.text.muted,
            fontFamily: 'DMMono',
            fontSize: 11,
            marginTop: 1,
          }}
        >
          {currentTrack.artist}
        </Text>
      </View>

      {/* Controls */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <Pressable
          onPress={handlePlayPause}
          hitSlop={12}
          style={{ padding: 6 }}
        >
          <Ionicons
            name={isPlaying ? 'pause' : 'play'}
            size={22}
            color={colors.foreground.dark}
          />
        </Pressable>
        <Pressable
          onPress={() => usePlaybackStore.getState().next()}
          hitSlop={12}
          style={{ padding: 6 }}
        >
          <Ionicons name="play-skip-forward" size={20} color={colors.text.muted} />
        </Pressable>
      </View>
    </Pressable>
  );
}
