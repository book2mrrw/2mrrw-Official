// Opt-in release gate. Run with the existing alias loader.
// Independently checks the application's PostgreSQL project/TLS contract; metadata only.
import postgres from 'postgres';
import { SUPABASE_DATABASE_CA } from '@/lib/supabase/database-ca';
import { SUPABASE_URL } from '@/lib/supabase/supabase-url';

let connection;
try {
  const expected = process.env.OWNERSHIP_EXPECTED_PROJECT;
  const project = new URL(SUPABASE_URL).hostname.split('.')[0];
  if (!expected || expected !== project) {
    throw Object.assign(new Error(), { code: 'OWNERSHIP_PROJECT_MISMATCH' });
  }
  const database = new URL(process.env.POSTGRES_URL || 'invalid:');
  const databaseProject = database.username.startsWith('postgres.') ? database.username.slice(9)
    : database.hostname.match(/^db\.([^.]+)\.supabase\.co$/)?.[1];
  if (!['postgres:', 'postgresql:'].includes(database.protocol) || databaseProject !== project
    || !(database.hostname === `db.${project}.supabase.co` || database.hostname.endsWith('.pooler.supabase.com'))) {
    throw Object.assign(new Error(), { code: 'OWNERSHIP_DATABASE_PROJECT_MISMATCH' });
  }
  connection = postgres(database.href, { ssl: { ca: SUPABASE_DATABASE_CA, rejectUnauthorized: true }, max: 1, prepare: false, connect_timeout: 10, idle_timeout: 1, onnotice: () => {} });
  const result = await connection.begin('read only', async (tx) => {
    const rows = await tx.unsafe(`select current_user as role,
      to_regclass('public.ownership_email_challenges')::text as challenge_table,
      has_table_privilege(current_user,'auth.users','SELECT') as auth_select,
      has_table_privilege(current_user,'auth.users','UPDATE') as auth_row_lock,
      has_table_privilege(current_user,'public.profiles','SELECT') as profile_select,
      has_table_privilege(current_user,'public.profiles','UPDATE') as profile_row_lock,
      has_table_privilege(current_user,'public.products','SELECT') as product_select,
      has_table_privilege(current_user,'public.products','UPDATE') as product_row_lock,
      (has_table_privilege(current_user,'public.purchases','SELECT') and
        has_table_privilege(current_user,'public.purchases','INSERT') and
        has_table_privilege(current_user,'public.purchases','UPDATE')) as purchase_write,
      (has_table_privilege(current_user,'public.library_items','SELECT') and
        has_table_privilege(current_user,'public.library_items','INSERT') and
        has_table_privilege(current_user,'public.library_items','UPDATE')) as library_write,
      (has_table_privilege(current_user,'public.entitlements','SELECT') and
        has_table_privilege(current_user,'public.entitlements','INSERT') and
        has_table_privilege(current_user,'public.entitlements','UPDATE')) as entitlement_write,
      (has_table_privilege(current_user,'public.gifts','SELECT') and
        has_table_privilege(current_user,'public.gifts','UPDATE')) as gift_write,
      (has_table_privilege(current_user,'public.user_entitlements','SELECT') and
        has_table_privilege(current_user,'public.user_entitlements','INSERT') and
        has_table_privilege(current_user,'public.user_entitlements','UPDATE')) as vault_write,
      has_table_privilege(current_user,'public.signals','INSERT') as signal_write,
      case when to_regclass('public.ownership_email_challenges') is not null then
        has_table_privilege(current_user,'public.ownership_email_challenges','SELECT') and
        has_table_privilege(current_user,'public.ownership_email_challenges','INSERT') and
        has_table_privilege(current_user,'public.ownership_email_challenges','UPDATE')
        else null end as challenge_write`);
    return rows[0];
  });
  for (const [key, value] of Object.entries(result)) {
    if (key === 'challenge_write' && !result.challenge_table) continue;
    if (key !== 'role' && key !== 'challenge_table' && value !== true) {
      throw Object.assign(new Error(), { code: 'OWNERSHIP_PRIVILEGE_MISSING' });
    }
  }
  console.log('OWNERSHIP_CONNECTION_VERIFIED ' + JSON.stringify({
    project, driver: 'postgres', tls: 'verify-full', readOnly: true, ...result,
  }));
  if (!result.challenge_table) {
    throw Object.assign(new Error(), { code: 'MIGRATION_REQUIRED_AFTER_CONNECTION_VERIFIED' });
  }
} catch (error) {
  // Provider/database messages can contain connection details. Print codes only.
  console.error('OWNERSHIP_CONNECTION_FAILED ' + JSON.stringify({ code: error.code || 'UNAVAILABLE' }));
  process.exitCode = 67;
} finally {
  if (connection) await connection.end({ timeout: 2 });
}
