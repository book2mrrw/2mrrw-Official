import { FlatList, View, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { ReleaseCard } from '@/components/releases/ReleaseCard';
import { fetchCatalogReleases } from '@/lib/api/catalog';
import { useViewableReleaseIds } from '@/hooks/useViewableReleaseIds';
import type { CatalogRelease } from '@2mrrw/types';

export default function ReleasesScreen() {
  const { viewableIds, onViewableItemsChanged, viewabilityConfig } = useViewableReleaseIds();
  const { data, isLoading } = useQuery({
    queryKey: ['catalog', 'releases'],
    queryFn: fetchCatalogReleases,
  });

  const releases = data?.releases ?? [];

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      <View className="px-5 pt-4 pb-3">
        <Text className="font-mono text-muted text-xs tracking-widest uppercase">
          Catalog
        </Text>
        <Text className="font-display text-foreground text-3xl mt-1">
          All Releases
        </Text>
      </View>
      <FlatList
        data={releases}
        keyExtractor={(item: CatalogRelease) => item.id}
        numColumns={2}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 140 }}
        columnWrapperStyle={{ gap: 12, marginBottom: 12 }}
        renderItem={({ item }) => (
          <ReleaseCard release={item} active={viewableIds.has(item.id)} />
        )}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        showsVerticalScrollIndicator={false}
      />
    </SafeAreaView>
  );
}
