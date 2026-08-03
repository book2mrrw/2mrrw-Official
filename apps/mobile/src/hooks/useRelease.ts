import { useQuery } from '@tanstack/react-query';
import { fetchReleaseBySlug, fetchCatalogReleases } from '@/lib/api/catalog';

export function useRelease(slug: string) {
  return useQuery({
    queryKey: ['release', slug],
    queryFn: () => fetchReleaseBySlug(slug),
    enabled: !!slug,
    staleTime: 5 * 60 * 1000,
  });
}

export function useCatalog() {
  return useQuery({
    queryKey: ['catalog'],
    queryFn: fetchCatalogReleases,
    staleTime: 5 * 60 * 1000,
  });
}
