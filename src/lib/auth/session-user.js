import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getGuestUser } from "@/lib/guest-session";

export async function getFanSessionUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user?.email && !user.email.endsWith("@guest.2mrrw.local")) {
    const admin = createAdminClient();
    const { data: profile } = await admin
      .from("profiles")
      .select("email, phone, full_name, role")
      .eq("id", user.id)
      .maybeSingle();

    return {
      id: user.id,
      email: profile?.email || user.email,
      authEmail: user.email || "",
      phone: profile?.phone || "",
      name: profile?.full_name || "",
      isGuest: false,
      isOtp: true,
      role: profile?.role || "user",
    };
  }

  const guest = await getGuestUser();
  if (guest) return guest;
  return null;
}
