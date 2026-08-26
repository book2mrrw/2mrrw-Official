import { NextResponse } from "next/server";
import { requireAdminOrCapability, requireServiceCapability, ServiceCapability } from "@/lib/auth/admin-api-guard";
import { getAdminSessionUser } from "@/lib/auth/admin-api-guard";
import { isAdminUser } from "@/lib/auth/constants";
import { revalidateStorefront } from "@/lib/media/revalidate-storefront";

export const dynamic = "force-dynamic";

export async function POST(req) {
  // Admin session, or the scoped CATALOG_REVALIDATE capability for the
  // server-to-server call the publish endpoint makes.
  const validSecret = requireServiceCapability(req, ServiceCapability.CATALOG_REVALIDATE).ok;   // INV-ADMIN-3

  if (!validSecret) {
    const user = await getAdminSessionUser();
    if (!user || !isAdminUser(user)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  revalidateStorefront();

  return NextResponse.json({ revalidated: true, timestamp: Date.now() });
}
