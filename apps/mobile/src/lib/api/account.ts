import { supabase } from '@/lib/supabase';
import type { UserProfile } from '@2mrrw/types';

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? '';

export async function fetchAccountState(): Promise<{ user: UserProfile | null } | null> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) return null;

  const res = await fetch(`${API_BASE}/api/account/state`, {
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  if (!res.ok) return null;
  return res.json();
}

export async function fetchStreamSrc(
  slug: string,
  trackSlug?: string
): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(`${API_BASE}/api/stream/resolve`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(session?.access_token
        ? { Authorization: `Bearer ${session.access_token}` }
        : {}),
    },
    body: JSON.stringify({ slug, trackSlug }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.src ?? null;
}
