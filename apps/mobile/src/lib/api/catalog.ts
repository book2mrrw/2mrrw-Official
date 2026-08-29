import { supabase } from '@/lib/supabase';
import type { CatalogRelease } from '@2mrrw/types';

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? '';

export async function fetchCatalogReleases(): Promise<{ releases: CatalogRelease[] }> {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(`${API_BASE}/api/catalog/releases?view=platform`, {
    headers: {
      ...(session?.access_token
        ? { Authorization: `Bearer ${session.access_token}` }
        : {}),
    },
  });
  if (!res.ok) throw new Error(`Catalog fetch failed: ${res.status}`);
  return res.json();
}

export async function fetchReleaseBySlug(
  slug: string
): Promise<{ release: CatalogRelease | null }> {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(`${API_BASE}/api/catalog/releases/${slug}`, {
    headers: {
      ...(session?.access_token
        ? { Authorization: `Bearer ${session.access_token}` }
        : {}),
    },
  });
  if (!res.ok) throw new Error(`Release fetch failed: ${res.status}`);
  return res.json();
}

export async function fetchHydratedCatalog(slugs: string[]): Promise<{ releases: CatalogRelease[] }> {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(`${API_BASE}/api/catalog/hydrate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(session?.access_token
        ? { Authorization: `Bearer ${session.access_token}` }
        : {}),
    },
    body: JSON.stringify({ slugs }),
  });
  if (!res.ok) throw new Error(`Hydrate failed: ${res.status}`);
  return res.json();
}
