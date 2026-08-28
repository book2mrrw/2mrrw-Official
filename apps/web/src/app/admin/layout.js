import { redirect } from "next/navigation";
import { requireAdminActor } from "@/lib/auth/admin-api-guard";
import { loginRedirectPath } from "@/lib/auth/route-access-policy";

export const dynamic = "force-dynamic";

/** Admin pages use the same server-controlled identity + MFA authority as admin APIs. */
export default async function AdminLayout({ children }) {
  const actor = await requireAdminActor({ logDenial: false });
  if (!actor.ok) redirect(loginRedirectPath("/admin"));
  return children;
}
