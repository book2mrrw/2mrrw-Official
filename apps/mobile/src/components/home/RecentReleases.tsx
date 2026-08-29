import { View, Text, FlatList } from 'react-native';
import { ReleaseCard } from '@/components/releases/ReleaseCard';
import { useViewableReleaseIds } from '@/hooks/useViewableReleaseIds';
import type { CatalogRelease } from '@2mrrw/types';
import { colors } from '@2mrrw/design-system';

interface Props {
  releases: CatalogRelease[];
  loading?: boolean;
}

export function RecentReleases({ releases, loading }: Props) {
  const { viewableIds, onViewableItemsChanged, viewabilityConfig } = useViewableReleaseIds();

  return (
    <View style={{ marginBottom: 16 }}>
      <Text
        style={{
          color: colors.text.muted,
          fontFamily: 'DMMono',
          fontSize: 10,
          letterSpacing: 2,
          textTransform: 'uppercase',
          marginHorizontal: 20,
          marginBottom: 12,
        }}
      >
        More Releases
      </Text>
      <FlatList
        data={releases}
        keyExtractor={(item) => item.id}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
        renderItem={({ item }) => (
          <ReleaseCard release={item} active={viewableIds.has(item.id)} />
        )}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
      />
    </View>
  );
}
