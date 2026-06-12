"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Legacy /verify-otp route — redirects to home and opens AuthGate for codes.
 * Supabase Auth redirect URL should be https://artist-platform-silk.vercel.app
 * (not /verify-otp). Magic links land on /; AuthContext restores the session.
 */
function VerifyOtpRedirect() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const email = searchParams.get("email") || "";
  const nextPath = searchParams.get("next") || "/";

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const supabase = createClient();
        const { data } = await supabase.auth.getSession();
        const sessionUser = data?.session?.user;
        const isRealUser =
          sessionUser?.email && !sessionUser.email.endsWith("@guest.2mrrw.local");

        if (isRealUser) {
          if (mounted) router.replace(nextPath);
          return;
        }
      } catch {
        /* fall through to AuthGate */
      }

      if (typeof window !== "undefined") {
        if (email) sessionStorage.setItem("pendingOtpEmail", email);
      }
      if (mounted) router.replace(nextPath);
    })();

    return () => {
      mounted = false;
    };
  }, [email, nextPath, router]);

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#050505",
        color: "#888",
        display: "grid",
        placeItems: "center",
        fontFamily: "sans-serif",
        fontSize: 14,
      }}
    >
      Redirecting…
    </main>
  );
}

export default function VerifyOtpPage() {
  return (
    <Suspense fallback={<main style={{ minHeight: "100vh", background: "#050505" }} />}>
      <VerifyOtpRedirect />
    </Suspense>
  );
}
