import { View, Text, Pressable, Dimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated';
import { usePlaybackStore } from '@/stores/playback-store';
import { PlaybackControls } from '@/components/audio/PlaybackControls';
import { ProgressBar } from '@/components/audio/ProgressBar';
import { VolumeControl } from '@/components/audio/VolumeControl';
import { TrackInfo } from '@/components/audio/TrackInfo';
import { formatDuration } from '@2mrrw/core';

const { width } = Dimensions.get('window');
const ARTWORK_SIZE = width - 64;

export default function PlayerScreen() {
  const router = useRouter();
  const { currentTrack, isPlaying, currentTime, duration } = usePlaybackStore();

  if (!currentTrack) {
    router.back();
    return null;
  }

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top', 'bottom']}>
      {/* Dismiss handle */}
      <Pressable onPress={() => router.back()} className="items-center pt-2 pb-4">
        <View className="w-10 h-1 rounded-full bg-white/20" />
      </Pressable>

      {/* Artwork */}
      <View className="items-center px-8 mb-8">
        <Image
          source={{ uri: currentTrack.cover ?? undefined }}
          style={{ width: ARTWORK_SIZE, height: ARTWORK_SIZE, borderRadius: 12 }}
          contentFit="cover"
          transition={300}
        />
      </View>

      {/* Track info */}
      <TrackInfo track={currentTrack} className="px-8 mb-6" />

      {/* Progress */}
      <View className="px-8 mb-4">
        <ProgressBar />
        <View className="flex-row justify-between mt-1">
          <Text className="font-mono text-muted text-xs">
            {formatDuration(currentTime)}
          </Text>
          <Text className="font-mono text-muted text-xs">
            {formatDuration(duration)}
          </Text>
        </View>
      </View>

      {/* Controls */}
      <PlaybackControls className="px-8 mb-6" />

      {/* Volume */}
      <VolumeControl className="px-8" />
    </SafeAreaView>
  );
}
