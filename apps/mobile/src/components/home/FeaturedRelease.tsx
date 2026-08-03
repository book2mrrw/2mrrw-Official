import { View, Text, Pressable, Dimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { usePlaybackStore } from '@/stores/playback-store';
import type { CatalogRelease } from '@2mrrw/types';
import { colors } from '@2mrrw/design-system';

const { width } = Dimensions.get('window');

interface Props {
  release: CatalogRelease;
  loading?: boolean;
}

export function FeaturedRelease({ release, loading }: Props) {
  const router = useRouter();
  const { playQueue } = usePlaybackStore();

  const handlePlay = () => {
    if (release.tracks.length) {
      playQueue(release.tracks as any, 0);
    }
  };

  return (
    <Pressable
      onPress={() => router.push(`/release/${release.slug}`)}
      style={{ marginHorizontal: 16, marginBottom: 24 }}
    >
      <View style={{ borderRadius: 16, overflow: 'hidden' }}>
        <Image
          source={{ uri: release.cover ?? undefined }}
          style={{ width: width - 32, height: width - 32 }}
          contentFit="cover"
          transition={400}
        />
        <LinearGradient
          colors={['transparent', 'rgba(10,10,10,0.9)']}
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: '60%',
            justifyContent: 'flex-end',
            padding: 20,
          }}
        >
          <Text
            style={{
              color: colors.text.muted,
              fontFamily: 'DMMono',
              fontSize: 10,
              letterSpacing: 2,
              textTransform: 'uppercase',
              marginBottom: 4,
            }}
          >
            Latest Release
          </Text>
          <Text
            style={{
              color: colors.foreground.dark,
              fontFamily: 'CormorantGaramond',
              fontSize: 32,
              fontWeight: '500',
              lineHeight: 38,
            }}
            numberOfLines={2}
          >
            {release.title}
          </Text>
          <Pressable
            onPress={handlePlay}
            style={{
              marginTop: 12,
              flexDirection: 'row',
              alignItems: 'center',
              alignSelf: 'flex-start',
              backgroundColor: colors.foreground.dark,
              paddingHorizontal: 16,
              paddingVertical: 8,
              borderRadius: 20,
              gap: 6,
            }}
          >
            <Ionicons name="play" size={14} color={colors.background.dark} />
            <Text
              style={{
                color: colors.background.dark,
                fontFamily: 'DMMono',
                fontSize: 12,
              }}
            >
              Play
            </Text>
          </Pressable>
        </LinearGradient>
      </View>
    </Pressable>
  );
}
