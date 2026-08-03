import { View, Text } from 'react-native';
import type { UserProfile } from '@2mrrw/types';
import { colors } from '@2mrrw/design-system';

interface Props {
  user: UserProfile;
}

interface Badge {
  label: string;
  active: boolean;
  color: string;
}

export function EntitlementBadges({ user }: Props) {
  const badges: Badge[] = [
    { label: 'Subscriber', active: user.hasSubscription, color: colors.accent.primary },
    { label: 'Collector', active: user.hasCollectorCard, color: '#a78bfa' },
    { label: 'Vault', active: user.hasVaultAccess, color: '#fbbf24' },
  ];

  const active = badges.filter((b) => b.active);
  if (!active.length) return null;

  return (
    <View style={{ flexDirection: 'row', paddingHorizontal: 20, gap: 8, marginBottom: 24 }}>
      {active.map((badge) => (
        <View
          key={badge.label}
          style={{
            paddingHorizontal: 12,
            paddingVertical: 5,
            borderRadius: 20,
            borderWidth: 1,
            borderColor: badge.color,
          }}
        >
          <Text
            style={{
              color: badge.color,
              fontFamily: 'DMMono',
              fontSize: 10,
              letterSpacing: 1,
              textTransform: 'uppercase',
            }}
          >
            {badge.label}
          </Text>
        </View>
      ))}
    </View>
  );
}
