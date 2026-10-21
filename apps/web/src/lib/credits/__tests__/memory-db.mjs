import assert from "node:assert/strict";
export function memoryDb(seed = {}, errors = {}) {
  const rows = structuredClone(seed);
  const calls = [];
  return {
    rows, calls,
    from(table) {
      let filters = [], order = null, limit = Infinity, action = "select", patch;
      const compare = (a, b) => a === b ? 0 : a < b ? -1 : 1;
      const q = {
        select() { return q; },
        eq(key, value) { filters.push({ key, value, test: (r) => r[key] === value }); return q; },
        is(key, value) { return q.eq(key, value); },
        in(key, value) { filters.push({ key, value, test: (r) => value.includes(r[key]) }); return q; },
        gt(key, value) { filters.push({ key, value, test: (r) => r[key] != null && compare(r[key], value) > 0 }); return q; },
        lte(key, value) { filters.push({ key, value, test: (r) => r[key] != null && compare(r[key], value) <= 0 }); return q; },
        or(expression) {
          const clauses = expression.split(",").map((part) => {
            const [, key, op, value] = part.match(/^([^.]+)\.(is|gt|lte)\.(.+)$/) || [];
            assert.ok(key, `Unsupported test predicate ${part}`);
            return (r) => op === "is" ? value === "null" && r[key] == null
              : r[key] != null && (op === "gt" ? compare(r[key], value) > 0 : compare(r[key], value) <= 0);
          });
          filters.push({ key: "or", value: expression, test: (r) => clauses.some((f) => f(r)) }); return q;
        },
        order(key, options = {}) { order = { key, ascending: options.ascending !== false }; return q; },
        limit(value) { limit = value; return q; },
        update(value) { action = "update"; patch = value; return q; },
        delete() { action = "delete"; return q; },
        single() { return execute(true); }, maybeSingle() { return execute(true); },
        then(ok, fail) { return execute(false).then(ok, fail); },
      };
      async function execute(single) {
        calls.push({ table, action, filters: filters.map(({ key, value }) => ({ key, value })) });
        if (errors[table]) return { data: null, error: errors[table] };
        let matches = (rows[table] || []).filter((r) => filters.every((f) => f.test(r)));
        if (order) matches.sort((a, b) => compare(a[order.key], b[order.key]) * (order.ascending ? 1 : -1));
        matches = matches.slice(0, limit);
        if (action === "update") matches.forEach((r) => Object.assign(r, patch));
        if (action === "delete") rows[table] = (rows[table] || []).filter((r) => !matches.includes(r));
        return { data: single ? matches[0] || null : matches, error: null };
      }
      return q;
    },
  };
}
