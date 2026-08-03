import { ScrollView, View, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { FeaturedRelease } from '@/components/home/FeaturedRelease';
import { RecentReleases } from '@/components/home/RecentReleases';
import { fetchCatalogReleases } from '@/lib/api/catalog';

export default function HomeScreen() {
  const { data, isLoading } = useQuery({
    queryKey: ['catalog', 'releases'],
    queryFn: fetchCatalogReleases,
  });

  const releases = data?.releases ?? [];
  const featured = releases[0] ?? null;
  const recent = releases.slice(1);

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 140 }}
        showsVerticalScrollIndicator={false}
      >
        <View className="px-5 pt-4 pb-2">
          <Text className="font-mono text-muted text-xs tracking-widest uppercase">
            2MRRW
          </Text>
          <Text className="font-display text-foreground text-3xl mt-1">
            New Music
          </Text>
        </View>

        {featured && <FeaturedRelease release={featured} loading={isLoading} />}
        {recent.length > 0 && <RecentReleases releases={recent} loading={isLoading} />}
      </ScrollView>
    </SafeAreaView>
  );
}
