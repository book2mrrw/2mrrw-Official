/** Shared, scope-local credit reader. Never borrows the first recording's credits. */
export const CREDIT_CATEGORIES = ['songwriter', 'producer', 'featured_artist'];
export const CREDIT_LABELS = { songwriter: 'Written By', producer: 'Produced By', featured_artist: 'Featured Artists' };
const roles = {
  writer: 'songwriter', songwriter: 'songwriter', 'written by': 'songwriter', written_by: 'songwriter', writtenBy: 'songwriter',
  producer: 'producer', 'produced by': 'producer', produced_by: 'producer', producedBy: 'producer',
  featured: 'featured_artist', 'featured artist': 'featured_artist', 'featured artists': 'featured_artist', featured_artist: 'featured_artist', featured_artists: 'featured_artist', featuredArtists: 'featured_artist', featuring: 'featured_artist',
  mixing: 'mixing_engineer', 'mixing engineer': 'mixing_engineer', mixing_engineer: 'mixing_engineer', mixed_by: 'mixing_engineer', mixedBy: 'mixing_engineer', mixingEngineer: 'mixing_engineer',
  mastering: 'mastering_engineer', 'mastering engineer': 'mastering_engineer', mastering_engineer: 'mastering_engineer', mastered_by: 'mastering_engineer', masteredBy: 'mastering_engineer', masteringEngineer: 'mastering_engineer',
  executive_producer: 'executive_producer', 'executive producer': 'executive_producer', collaborators: 'collaborator', collaborator: 'collaborator', record_label: 'label', recordLabel: 'label', label: 'label',
};
const own = (o, k) => Object.prototype.hasOwnProperty.call(o || {}, k);
const object = (v) => v && typeof v === 'object' && !Array.isArray(v) ? v : {};
const nameOf = (v) => typeof v === 'string' ? v.trim() : String(v?.name ?? v?.display_name ?? v?.displayName ?? '').trim();
export function canonicalCreditRole(role) {
  const key = String(role || 'Contributor').trim();
  return own(roles, key) ? roles[key] : own(roles, key.toLowerCase()) ? roles[key.toLowerCase()] : key;
}

export function normalizeCredits(source) {
  if (!source) return [];
  const result = [];
  const resolved = new Set();
  const append = (role, values) => {
    const category = canonicalCreditRole(role);
    if (resolved.has(category)) return;
    resolved.add(category); // Explicit [] suppresses a lower-priority historical value.
    for (const value of (Array.isArray(values) ? values : values == null ? [] : [values])) {
      const name = nameOf(value);
      if (!name) continue;
      result.push({ name, role: category, ...(value?.contributor_id || value?.contributorId ? { contributor_id: value.contributor_id || value.contributorId } : {}), ...(value?.id ? { id: value.id } : {}) });
    }
  };
  const consume = (payload) => {
    if (Array.isArray(payload)) {
      const grouped = new Map();
      for (const entry of payload) { const role = canonicalCreditRole(entry?.role); if (!grouped.has(role)) grouped.set(role, []); grouped.get(role).push(entry); }
      for (const [role, entries] of grouped) append(role, entries);
    } else {
      const p = object(payload);
      for (const [category, group] of Object.entries(object(p.groups))) append(category, group?.entries);
      for (const [key, value] of Object.entries(p)) if (own(roles, key)) append(roles[key], value);
    }
  };
  // Current scoped fields outrank old nested copies. Never read source.tracks.
  consume(source.credits);
  consume(source);
  consume(source.metadata?.credits);
  consume(source.metadata);
  return result;
}

export function creditRows(source) {
  const labels = { ...CREDIT_LABELS, mixing_engineer: 'Mixing Engineer', mastering_engineer: 'Mastering Engineer', executive_producer: 'Executive Producer', collaborator: 'Collaborators', label: 'Record Label' };
  const grouped = new Map();
  for (const entry of normalizeCredits(source)) {
    if (!grouped.has(entry.role)) grouped.set(entry.role, []);
    grouped.get(entry.role).push(entry.name);
  }
  return [...grouped].map(([key, names]) => ({ key, label: labels[key] || key, value: names.join(', ') }));
}

/** Public attribution deliberately excludes allocations and directory private fields. */
export function publicCredits(source) { return normalizeCredits(source).map(({ name, role, contributor_id, id }) => ({ name, role, ...(contributor_id ? { contributor_id } : {}), ...(id ? { id } : {}) })); }

export function percentageHundredths(value) {
  const text = typeof value === 'string' ? value : typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
  if (!/^(?:0|[1-9]\d{0,2})(?:\.\d{1,2})?$/.test(text)) throw new Error('Enter a percentage from 0 to 100 with at most two decimal places.');
  const [whole, fraction = ''] = text.split('.');
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (amount > 10000) throw new Error('A percentage cannot exceed 100.00%.');
  return amount;
}

export function allocationResult(group, category) {
  const entries = Array.isArray(group?.entries) ? group.entries : [];
  const errors = [];
  if (!group || typeof group !== 'object' || Array.isArray(group) || !Array.isArray(group.entries)) return { total: 0, formattedTotal: '0.00', errors: ['An allocation must contain a list of contributors.'], valid: false };
  if (group.entries.length > 200) errors.push('A category may contain at most 200 contributors.');
  let total = 0;
  if (!['legacy', 'draft', 'complete', 'not_applicable'].includes(group?.state)) errors.push('Invalid allocation state.');
  if (category === 'songwriter' && group?.state === 'not_applicable' && entries.length) errors.push('Songwriter entries cannot be marked not applicable.');
  if (group?.state === 'not_applicable' && entries.some(e => e?.percentage !== '' && e?.percentage != null)) errors.push('Not-applicable allocations cannot contain percentages.');
  const identities = new Set();
  for (const [index, entry] of entries.entries()) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) { errors.push(`Contributor ${index + 1} is invalid.`); continue; }
    if (typeof entry.name !== 'string' || entry.name.length > 200 || !nameOf(entry)) errors.push(`Contributor ${index + 1} needs a name.`);
    if (entry.contributor_id) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(entry.contributor_id)) errors.push(`Contributor ${index + 1} has an invalid identity.`);
      if (identities.has(entry.contributor_id)) errors.push('The same contributor is listed twice in this category.');
      identities.add(entry.contributor_id);
    }
    if (category === 'featured_artist') continue;
    if (entry.percentage === '' || entry.percentage == null) { if (group?.state === 'complete') errors.push(`Contributor ${index + 1} needs a percentage.`); continue; }
    try { total += percentageHundredths(entry.percentage); } catch (error) { errors.push(`Contributor ${index + 1}: ${error.message}`); }
  }
  if (category !== 'featured_artist' && total > 10000) errors.push('The allocation total exceeds 100.00%.');
  if (category !== 'featured_artist' && group?.state === 'complete' && (total !== 10000 || !entries.length)) errors.push('A completed allocation must total exactly 100.00%.');
  return { total, formattedTotal: `${Math.floor(total / 100)}.${String(total % 100).padStart(2, '0')}`, errors, valid: errors.length === 0 };
}

export function editableCreditGroups(source) {
  const stored = object(source?.credit_groups);
  const credits = normalizeCredits(source);
  return Object.fromEntries(CREDIT_CATEGORIES.map(category => [category, own(stored, category) ? stored[category] : { state: 'legacy', entries: credits.filter(e => e.role === category).map((e, index) => ({ ...e, row_id: e.id || `${category}:${index}`, percentage: '' })) }]));
}

export function validateCreditGroups(groups) {
  if (!groups || typeof groups !== 'object' || Array.isArray(groups)) return ['Credits must be an object.'];
  return Object.entries(groups).flatMap(([category, group]) => !CREDIT_CATEGORIES.includes(category) ? [`Unsupported editable category: ${category}`] : allocationResult(group, category).errors.map(e => `${CREDIT_LABELS[category]}: ${e}`));
}

/** Patch legacy projections without discarding unknown/extended roles. */
export function mergeCreditProjection(existing, groups) {
  const aliases = { songwriter: 'written_by', producer: 'produced_by', featured_artist: 'featured_artists' };
  if (Array.isArray(existing)) {
    return [...existing.filter(e => !own(groups, canonicalCreditRole(e?.role))), ...Object.entries(groups).flatMap(([role, group]) => group.entries.map(({ name, contributor_id }) => ({ name, role, ...(contributor_id ? { contributor_id } : {}) })))];
  }
  const next = { ...object(existing) };
  for (const [category, group] of Object.entries(groups)) {
    for (const key of Object.keys(next)) if (canonicalCreditRole(key) === category) delete next[key];
    next[aliases[category]] = group.entries.map(({ name, contributor_id }) => contributor_id ? { name, contributor_id } : name);
  }
  return next;
}

export function optionalIdentifier(value, label) {
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > 128 || /[\u0000-\u001f]/.test(value)) throw new Error(`${label} must be text, or empty to clear.`);
  return value.trim() || null; // Compatibility policy: do not impose a new format on legacy IDs.
}
