import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@2mrrw/design-system';

/**
 * Volume is controlled via hardware buttons only — no software slider.
 * This component shows a visual indicator that hardware volume is active.
 */
interface Props {
  className?: string;
}

export function VolumeControl({ className }: Props) {
  return (
    <View className={`flex-row items-center gap-3 ${className ?? ''}`}>
      <Ionicons name="volume-low" size={18} color={colors.text.muted} />
      <View
        style={{
          flex: 1,
          height: 3,
          backgroundColor: 'rgba(255,255,255,0.12)',
          borderRadius: 2,
        }}
      />
      <Ionicons name="volume-high" size={18} color={colors.text.muted} />
    </View>
  );
}
