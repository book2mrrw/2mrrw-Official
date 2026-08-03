import { View } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  runOnJS,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { usePlaybackStore } from '@/stores/playback-store';
import { colors } from '@2mrrw/design-system';

const BAR_HEIGHT = 4;

export function ProgressBar() {
  const { currentTime, duration, seek } = usePlaybackStore();
  const progress = duration > 0 ? Math.min(currentTime / duration, 1) : 0;

  const panX = useSharedValue(0);
  const isSeeking = useSharedValue(false);
  const seekWidth = useSharedValue(0);

  const handleSeek = (fraction: number) => {
    const t = Math.max(0, Math.min(1, fraction)) * duration;
    seek(t);
  };

  const pan = Gesture.Pan()
    .onBegin((e) => {
      isSeeking.value = true;
      panX.value = e.x;
    })
    .onUpdate((e) => {
      panX.value = e.x;
    })
    .onEnd((e) => {
      isSeeking.value = false;
      runOnJS(handleSeek)(e.x / (seekWidth.value || 1));
    });

  const tap = Gesture.Tap().onEnd((e) => {
    runOnJS(handleSeek)(e.x / (seekWidth.value || 1));
  });

  const animatedFill = useAnimatedStyle(() => ({
    width: `${progress * 100}%`,
  }));

  return (
    <GestureDetector gesture={Gesture.Race(pan, tap)}>
      <View
        onLayout={(e) => { seekWidth.value = e.nativeEvent.layout.width; }}
        style={{
          height: BAR_HEIGHT + 20,
          justifyContent: 'center',
        }}
      >
        <View
          style={{
            height: BAR_HEIGHT,
            backgroundColor: 'rgba(255,255,255,0.12)',
            borderRadius: BAR_HEIGHT / 2,
            overflow: 'hidden',
          }}
        >
          <Animated.View
            style={[
              {
                height: BAR_HEIGHT,
                backgroundColor: colors.foreground.dark,
                borderRadius: BAR_HEIGHT / 2,
              },
              animatedFill,
            ]}
          />
        </View>
      </View>
    </GestureDetector>
  );
}
