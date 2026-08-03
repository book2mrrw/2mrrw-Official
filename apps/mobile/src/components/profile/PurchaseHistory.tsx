import { View, Text } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { colors } from '@2mrrw/design-system';

interface Props {
  userId: string;
}

export function PurchaseHistory({ userId }: Props) {
  return (
    <View style={{ paddingHorizontal: 20 }}>
      <Text
        style={{
          color: colors.text.muted,
          fontFamily: 'DMMono',
          fontSize: 10,
          letterSpacing: 2,
          textTransform: 'uppercase',
          marginBottom: 12,
        }}
      >
        Purchases
      </Text>
      <Text
        style={{
          color: colors.text.muted,
          fontFamily: 'DMMono',
          fontSize: 12,
        }}
      >
        Purchase history coming soon.
      </Text>
    </View>
  );
}
