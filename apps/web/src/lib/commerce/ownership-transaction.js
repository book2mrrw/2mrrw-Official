import 'server-only';
import postgres from 'postgres';
import { SUPABASE_URL } from '@/lib/supabase/supabase-url';
let pool;
export async function ownershipTransaction(run) {
  if (!pool) {
    const url = new URL(process.env.POSTGRES_URL || 'invalid:');
    const expected = new URL(SUPABASE_URL).hostname.split('.')[0];
    const project = url.username.startsWith('postgres.') ? url.username.slice(9)
      : url.hostname.match(/^db\.([^.]+)\.supabase\.co$/)?.[1];
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || project !== expected || !(url.hostname === `db.${expected}.supabase.co` || url.hostname.endsWith('.pooler.supabase.com'))) throw new Error('ownership_database_unavailable');
    pool = postgres(url.href, { ssl: 'verify-full', max: 2, prepare: false, idle_timeout: 20, connect_timeout: 10 });
  }
  return pool.begin(async sql => run({ query: async (text, values = []) => ({ rows: await sql.unsafe(text, values) }) }));
}
const TABLES = new Set(['products', 'releases', 'library_items', 'entitlements', 'gifts', 'purchases', 'user_entitlements', 'signals']);
const ident = value => {
  if (!/^[a-z_][a-z0-9_]*$/.test(value)) throw new Error('Invalid ownership SQL identifier');
  return '"' + value + '"';
};
const parameter = v => v && typeof v === 'object' ? JSON.stringify(v) : v;
// Narrow transaction data port for existing grant functions; no request supplies SQL identifiers.
export function transactionAdmin(tx) {
  const client = { transaction: true, failure: null, afterCommit: [], from };
  function from(table) {
    if (!TABLES.has(table)) throw new Error('Unsupported ownership table');
    const filters = []; let action = 'select', patch, conflict, ignore;
    const q = {
      select() { return q; }, eq(k, v) { filters.push([k, '=', v]); return q; },
      neq(k, v) { filters.push([k, '<>', v]); return q; },
      in(k, v) { filters.push([k, 'in', v]); return q; },
      is(k, v) { if (v !== null) throw new Error('Unsupported predicate'); filters.push([k, 'is', v]); return q; },
      update(v) { action = 'update'; patch = v; return q; },
      insert(v) { action = 'insert'; patch = v; return q; },
      upsert(v, o = {}) { action = 'insert'; patch = v; conflict = o.onConflict?.split(','); ignore = o.ignoreDuplicates; return q; },
      single() { return execute("one"); }, maybeSingle() { return execute("optional"); },
      then(ok, bad) { return execute(false).then(ok, bad); },
    };
    async function execute(single) {
      try {
        const values = [], bind = v => { values.push(parameter(v)); return '$' + values.length; };
        const where = () => filters.length ? ' where ' + filters.map(([k, op, v]) => op === 'is' ? ident(k) + ' is null' : op === 'in'
          ? (v.length ? ident(k) + ' in (' + v.map(bind).join(',') + ')' : 'false') : ident(k) + op + bind(v)).join(' and ') : '';
        let query;
        if (action === 'select') query = 'select * from public.' + ident(table) + where();
        else if (action === 'update') query = 'update public.' + ident(table) + ' set ' + Object.keys(patch).map(k => ident(k) + '=' + bind(patch[k])).join(',') + where() + ' returning *';
        else {
          const rows = Array.isArray(patch) ? patch : [patch];
          if (!rows.length) return { data: single ? null : [], error: null };
          const keys = Object.keys(rows[0]);
          query = 'insert into public.' + ident(table) + ' (' + keys.map(ident).join(',') + ') values ' + rows.map(row => '(' + keys.map(k => bind(row[k] ?? null)).join(',') + ')').join(',');
          if (conflict) query += ' on conflict (' + conflict.map(ident).join(',') + ') ' + (ignore ? 'do nothing' : 'do update set ' + keys.filter(k => !conflict.includes(k)).map(k => ident(k) + '=excluded.' + ident(k)).join(','));
          query += ' returning *';
        }
        const { rows } = await tx.query(query, values);
        if (single && (rows.length > 1 || (single === "one" && rows.length !== 1))) {
          throw Object.assign(new Error("Ambiguous ownership row cardinality"), { code: "PGRST116" });
        }
        return { data: single ? rows[0] || null : rows, error: null };
      } catch (error) { client.failure ||= error; return { data: null, error }; }
    }
    return q;
  }
  return client;
}
