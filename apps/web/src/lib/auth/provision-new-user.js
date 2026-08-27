/**
 * Persists the application profile that completes a newly-created Supabase
 * Auth principal. If the profile write cannot commit, the Auth principal is
 * removed so callers never report a partially provisioned account.
 */
export async function persistNewUserProfileOrRollback(admin, {
  userId,
  profile,
  logPrefix = "auth.provision",
}) {
  const { error: profileError } = await admin
    .from("profiles")
    .upsert({ id: userId, ...profile }, { onConflict: "id" });

  if (!profileError) return { ok: true };

  const { error: rollbackError } = await admin.auth.admin.deleteUser(userId);
  console.error(`[${logPrefix}] profile persistence failed`, {
    userId,
    error: profileError.message,
    rollbackSucceeded: !rollbackError,
    rollbackError: rollbackError?.message || null,
  });

  return {
    ok: false,
    rollbackSucceeded: !rollbackError,
  };
}
