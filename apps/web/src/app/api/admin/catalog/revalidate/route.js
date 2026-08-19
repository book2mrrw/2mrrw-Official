import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getFanSessionUser } from "@/lib/auth/session-user";
import { isAdminUser } from "@/lib/auth/constants";

export const dynamic = "force-dynamic";

export async function POST(req) {
  // Allow both admin session auth and seed secret (for server-to-server calls from publish endpoint)
  const seedSecret = req.headers.get("x-seed-secret");
  const validSecret = seedSecret && seedSecret === process.env.ADMIN_SEED_SECRET;

  if (!validSecret) {
    const user = await getFanSessionUser();
    if (!user || !isAdminUser(user)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  revalidatePath("/");
  revalidatePath("/song/[slug]", "page");
  revalidatePath("/feature/[slug]", "page");
  revalidatePath("/album/[slug]", "page");

  return NextResponse.json({ revalidated: true, timestamp: Date.now() });
}
