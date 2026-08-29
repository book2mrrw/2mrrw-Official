import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";
import { SUPABASE_AUTH_STORAGE_KEY } from "@/lib/supabase/auth-storage-key";
import { SUPABASE_PUBLIC_KEY } from "@/lib/supabase/public-key";
import { SUPABASE_URL } from "@/lib/supabase/supabase-url";

export async function updateSession(request) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    SUPABASE_URL,
    SUPABASE_PUBLIC_KEY,
    {
      auth: {
        storageKey: SUPABASE_AUTH_STORAGE_KEY,
      },
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const { data, error } = await supabase.auth.getUser();
  const user = data?.user || null;
  const email = String(user?.email || "").trim().toLowerCase();
  const verifiedUser = !error && user?.id && email && !email.endsWith("@guest.2mrrw.local")
    ? user
    : null;

  return {
    response: supabaseResponse,
    user: verifiedUser,
    error: error || null,
  };
}
