import { ScrollView, View, Text, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { fetchReleaseBySlug } from '@/lib/api/catalog';
import { ReleaseArtwork } from '@/components/releases/ReleaseArtwork';
import { TrackRow } from '@/components/releases/TrackRow';
import { usePlaybackStore } from '@/stores/playback-store';
import { formatDuration } from '@2mrrw/core';
import type { CatalogTrack } from '@2mrrw/types';

export default function ReleaseScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const router = useRouter();
  const { playQueue } = usePlaybackStore();

  const { data, isLoading } = useQuery({
    queryKey: ['release', slug],
    queryFn: () => fetchReleaseBySlug(slug),
    enabled: Boolean(slug),
  });

  const release = data?.release ?? null;
  const tracks = release?.tracks ?? [];

  const handlePlayAll = () => {
    if (!tracks.length) return;
    playQueue(tracks as any, 0);
  };

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingBottom: 140 }}>
        {/* Header */}
        <View className="relative">
          {release ? (
            <ReleaseArtwork release={release} width="100%" height={300} />
          ) : (
            <View style={{ width: '100%', height: 300 }} />
          )}
          <Pressable
            onPress={() => router.back()}
            className="absolute top-4 left-4 bg-black/40 rounded-full p-2"
          >
            <Ionicons name="chevron-back" size={22} color="#ededed" />
          </Pressable>
        </View>

        <View className="px-5 pt-5 pb-3">
          <Text className="font-display text-foreground text-3xl">
            {release?.title ?? ''}
          </Text>
          <Text className="font-mono text-muted text-sm mt-1">
            {release?.artist} · {release?.type?.toUpperCase()}
          </Text>

          <Pressable
            onPress={handlePlayAll}
            className="mt-5 flex-row items-center justify-center py-3 rounded-xl bg-accent"
          >
            <Ionicons name="play" size={16} color="#0a0a0a" />
            <Text className="font-mono text-background text-sm ml-2 font-medium">
              Play All
            </Text>
          </Pressable>
        </View>

        {/* Track list */}
        <View className="px-5">
          {tracks.map((track: CatalogTrack, index: number) => (
            <TrackRow
              key={track.id}
              track={track}
              index={index}
              allTracks={tracks}
            />
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
