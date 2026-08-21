import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getFanSessionUser } from "@/lib/auth/session-user";
import { isAdminUser } from "@/lib/auth/constants";
import { getAdminClient } from "@/lib/supabase/admin";
import { runR2Ingest } from "@/lib/catalog/r2-ingest-pipeline";

export const dynamic = "force-dynamic";

export async function POST() {
  const user = await getFanSessionUser();
  if (!user || !isAdminUser(user)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const admin = getAdminClient();
    const result = await runR2Ingest({ admin, dryRun: false });

    // Bust the storefront ISR cache so changes are visible immediately
    try {
      revalidatePath("/");
      revalidatePath("/song/[slug]", "page");
      revalidatePath("/feature/[slug]", "page");
      revalidatePath("/album/[slug]", "page");
    } catch {}

    return NextResponse.json(result);
  } catch (err) {
    console.error("[ingest-trigger] unhandled error", err?.message);
    return NextResponse.json({ ok: false, error: err?.message || "Internal error" }, { status: 500 });
  }
}
