import { View, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { usePlaybackStore } from '@/stores/playback-store';
import { colors } from '@2mrrw/design-system';

interface Props {
  className?: string;
}

export function PlaybackControls({ className }: Props) {
  const { isPlaying, pause, resume, next, prev, repeat, setRepeat, shuffle, toggleShuffle } =
    usePlaybackStore();

  const handlePlayPause = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (isPlaying) await pause();
    else await resume();
  };

  const cycleRepeat = () => {
    const modes = ['off', 'all', 'one'] as const;
    const current = modes.indexOf(repeat);
    setRepeat(modes[(current + 1) % modes.length]);
  };

  const repeatIcon =
    repeat === 'one' ? 'repeat-outline' : repeat === 'all' ? 'repeat' : 'repeat';
  const repeatColor =
    repeat === 'off' ? colors.text.muted : colors.accent.primary;

  return (
    <View className={`flex-row items-center justify-between ${className ?? ''}`}>
      {/* Shuffle */}
      <Pressable onPress={toggleShuffle} hitSlop={12}>
        <Ionicons
          name="shuffle"
          size={22}
          color={shuffle ? colors.accent.primary : colors.text.muted}
        />
      </Pressable>

      {/* Previous */}
      <Pressable onPress={() => prev()} hitSlop={12}>
        <Ionicons name="play-skip-back" size={28} color={colors.foreground.dark} />
      </Pressable>

      {/* Play / Pause */}
      <Pressable
        onPress={handlePlayPause}
        style={{
          width: 64,
          height: 64,
          borderRadius: 32,
          backgroundColor: colors.foreground.dark,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Ionicons
          name={isPlaying ? 'pause' : 'play'}
          size={28}
          color={colors.background.dark}
        />
      </Pressable>

      {/* Next */}
      <Pressable onPress={() => next()} hitSlop={12}>
        <Ionicons name="play-skip-forward" size={28} color={colors.foreground.dark} />
      </Pressable>

      {/* Repeat */}
      <Pressable onPress={cycleRepeat} hitSlop={12}>
        <Ionicons name={repeatIcon} size={22} color={repeatColor} />
      </Pressable>
    </View>
  );
}
