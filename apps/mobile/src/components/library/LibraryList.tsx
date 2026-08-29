import { FlatList, View, Text } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { ReleaseCard } from '@/components/releases/ReleaseCard';
import { useViewableReleaseIds } from '@/hooks/useViewableReleaseIds';
import { fetchHydratedCatalog } from '@/lib/api/catalog';
import { colors } from '@2mrrw/design-system';

interface Props {
  userId: string;
}

export function LibraryList({ userId }: Props) {
  const { viewableIds, onViewableItemsChanged, viewabilityConfig } = useViewableReleaseIds();
  const { data, isLoading } = useQuery({
    queryKey: ['library', userId],
    queryFn: () => fetchHydratedCatalog([]),
  });

  const releases = data?.releases ?? [];

  if (isLoading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: colors.text.muted, fontFamily: 'DMMono', fontSize: 12 }}>
          Loading library…
        </Text>
      </View>
    );
  }

  if (!releases.length) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40 }}>
        <Text style={{ color: colors.text.muted, fontFamily: 'DMMono', fontSize: 12, textAlign: 'center' }}>
          Your purchased music will appear here.
        </Text>
      </View>
    );
  }

  return (
    <FlatList
      data={releases}
      keyExtractor={(item) => item.id}
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
  );
}
