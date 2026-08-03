import { useAuthStore } from '@/stores/auth-store';

export function useAuth() {
  const { user, loading, error, signOut, refresh } = useAuthStore();
  return { user, loading, error, isSignedIn: !!user, signOut, refresh };
}
