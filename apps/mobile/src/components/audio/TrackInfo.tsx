import { View, Text } from 'react-native';
import type { Track } from '@2mrrw/types';
import { colors } from '@2mrrw/design-system';

interface Props {
  track: Track;
  className?: string;
}

export function TrackInfo({ track, className }: Props) {
  return (
    <View className={className}>
      <Text
        numberOfLines={2}
        style={{
          color: colors.foreground.dark,
          fontFamily: 'CormorantGaramond',
          fontSize: 28,
          fontWeight: '500',
          lineHeight: 34,
        }}
      >
        {track.title}
      </Text>
      <Text
        numberOfLines={1}
        style={{
          color: colors.text.muted,
          fontFamily: 'DMMono',
          fontSize: 13,
          marginTop: 4,
          letterSpacing: 0.5,
        }}
      >
        {track.artist}
      </Text>
    </View>
  );
}
