import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { memoryLocalStorageAdapter } from "@supabase/ssr";

function getBrowserStorage() {
  if (typeof window === "undefined") return memoryLocalStorageAdapter();
  try {
    if (window.localStorage) return window.localStorage;
  } catch {
    // Safari ITP / private mode can deny access.
  }
  return memoryLocalStorageAdapter();
}

export function createClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      auth: {
        storage: getBrowserStorage(),
        storageKey: "2mrrw-auth-token",
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
        flowType: "pkce",
      },
    }
  );
}
