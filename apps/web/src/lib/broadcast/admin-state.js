/** Poll responses can arrive after command responses. Never regress a session revision. */
export function mergeAdminSession(rows, incoming) {
  const existing = rows.find((row) => row.id === incoming.id);
  if (existing && existing.sequence > incoming.sequence) return rows;
  return [incoming, ...rows.filter((row) => row.id !== incoming.id)];
}
