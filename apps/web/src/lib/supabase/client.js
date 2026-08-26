import { createBrowserClient } from "@supabase/ssr";
import { SUPABASE_AUTH_STORAGE_KEY } from "@/lib/supabase/auth-storage-key";
import { SUPABASE_PUBLIC_KEY } from "@/lib/supabase/public-key";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_PUBLIC_KEY,
    {
      auth: {
        storageKey: SUPABASE_AUTH_STORAGE_KEY,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
        flowType: "pkce",
      },
    }
  );
}
