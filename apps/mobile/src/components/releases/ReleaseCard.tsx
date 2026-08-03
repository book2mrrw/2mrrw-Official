import { View, Text, Pressable, Dimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import type { CatalogRelease } from '@2mrrw/types';
import { colors } from '@2mrrw/design-system';

const { width } = Dimensions.get('window');
const CARD_SIZE = (width - 44) / 2;

interface Props {
  release: CatalogRelease;
}

export function ReleaseCard({ release }: Props) {
  const router = useRouter();

  return (
    <Pressable
      onPress={() => router.push(`/release/${release.slug}`)}
      style={{ width: CARD_SIZE }}
    >
      <Image
        source={{ uri: release.cover ?? undefined }}
        style={{ width: CARD_SIZE, height: CARD_SIZE, borderRadius: 10 }}
        contentFit="cover"
        transition={200}
      />
      <Text
        numberOfLines={1}
        style={{
          color: colors.foreground.dark,
          fontFamily: 'Outfit',
          fontSize: 13,
          fontWeight: '500',
          marginTop: 6,
        }}
      >
        {release.title}
      </Text>
      <Text
        numberOfLines={1}
        style={{
          color: colors.text.muted,
          fontFamily: 'DMMono',
          fontSize: 10,
          marginTop: 1,
          letterSpacing: 0.3,
          textTransform: 'uppercase',
        }}
      >
        {release.type}
      </Text>
    </Pressable>
  );
}
