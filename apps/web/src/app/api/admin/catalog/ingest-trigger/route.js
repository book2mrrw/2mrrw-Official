import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { isAdminUser } from "@/lib/auth/constants";

export const dynamic = "force-dynamic";

export async function POST() {
  const cookieStore = await cookies();
  const sb = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { cookies: { getAll: () => cookieStore.getAll() } }
  );

  const { data: { user } } = await sb.auth.getUser();
  if (!user || !isAdminUser(user)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const base = process.env.NEXT_PUBLIC_SITE_URL || "https://www.2mrrw.com";
  const res = await fetch(`${base}/api/admin/catalog/r2-ingest`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-seed-secret": process.env.ADMIN_SEED_SECRET || "",
    },
    body: JSON.stringify({ dryRun: false }),
  });

  const json = await res.json();
  return NextResponse.json(json, { status: res.status });
}
