import { createBrowserClient } from "@supabase/ssr";
import { SUPABASE_AUTH_STORAGE_KEY } from "@/lib/supabase/auth-storage-key";
import { SUPABASE_PUBLIC_KEY } from "@/lib/supabase/public-key";
import { SUPABASE_URL } from "@/lib/supabase/supabase-url";

export function createClient() {
  return createBrowserClient(
    SUPABASE_URL,
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
