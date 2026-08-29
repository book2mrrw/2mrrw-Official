import { useRef, useState } from 'react';
import type { ViewToken } from 'react-native';
import type { CatalogRelease } from '@2mrrw/types';

function setsEqual(left: ReadonlySet<string>, right: ReadonlySet<string>) {
  if (left.size !== right.size) return false;
  for (const value of left) {
    if (!right.has(value)) return false;
  }
  return true;
}

/** Keep full-quality motion active only while its card is actually on screen. */
export function useViewableReleaseIds() {
  const [viewableIds, setViewableIds] = useState<ReadonlySet<string>>(() => new Set());
  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken<CatalogRelease>[] }) => {
      const next = new Set(
        viewableItems
          .filter((token) => token.isViewable)
          .map((token) => token.item.id)
      );
      setViewableIds((current) => setsEqual(current, next) ? current : next);
    }
  ).current;
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 60 }).current;

  return { viewableIds, onViewableItemsChanged, viewabilityConfig };
}
