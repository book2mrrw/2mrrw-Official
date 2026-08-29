import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { SUPABASE_AUTH_STORAGE_KEY } from "@/lib/supabase/auth-storage-key";
import { SUPABASE_PUBLIC_KEY } from "@/lib/supabase/public-key";
import { SUPABASE_URL } from "@/lib/supabase/supabase-url";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    SUPABASE_URL,
    SUPABASE_PUBLIC_KEY,
    {
      auth: {
        storageKey: SUPABASE_AUTH_STORAGE_KEY,
      },
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from Server Component — middleware handles refresh
          }
        },
      },
    }
  );
}
