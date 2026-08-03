import { create } from 'zustand';
import { supabase } from '@/lib/supabase';
import type { UserProfile } from '@2mrrw/types';
import { buildUserProfile } from '@2mrrw/auth';
import { fetchAccountState } from '@/lib/api/account';

interface AuthStoreState {
  user: UserProfile | null;
  loading: boolean;
  error: string | null;

  initialize: () => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

export const useAuthStore = create<AuthStoreState>((set, get) => ({
  user: null,
  loading: true,
  error: null,

  initialize: async () => {
    set({ loading: true, error: null });
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        set({ user: null, loading: false });
        return;
      }
      await get().refresh();
    } catch (err) {
      set({ error: String(err), loading: false });
    }
  },

  refresh: async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        set({ user: null, loading: false });
        return;
      }
      const account = await fetchAccountState();
      if (account?.user) {
        set({ user: account.user, loading: false, error: null });
      } else {
        set({ user: null, loading: false });
      }
    } catch (err) {
      set({ error: String(err), loading: false });
    }
  },

  signOut: async () => {
    await supabase.auth.signOut();
    set({ user: null, error: null });
  },
}));
