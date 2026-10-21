import { editableCreditGroups, mergeCreditProjection, optionalIdentifier, validateCreditGroups } from './contract';

/** Older full-form clients send empty defaults. Only v1 patches may delete attribution. */
export function publicationCredits(existing, patch, { allowClear = false } = {}) {
  let next = existing;
  if (patch?.credit_groups) {
    if (patch.credit_patch_version !== 1) throw new Error('Structured credits require credit patch version 1.');
    const errors = validateCreditGroups(patch.credit_groups);
    if (errors.length) throw new Error(errors.join(' '));
    next = mergeCreditProjection(next, patch.credit_groups);
  } else {
    const categories = { written_by: 'songwriter', produced_by: 'producer', featured_artists: 'featured_artist' };
    const groups = {};
    for (const [key, category] of Object.entries(categories)) {
      if (!Object.hasOwn(patch, key)) continue;
      if (!Array.isArray(patch[key])) throw new Error(`${key} must be a list.`);
      if (!patch[key].length && !allowClear) continue;
      const source = editableCreditGroups({ [key]: patch[key] });
      groups[category] = source[category];
    }
    next = mergeCreditProjection(next, groups);
  }
  // Preserve extended roles, including explicit empty legacy defaults. Editing
  // these roles is out of scope; no new client may silently wipe their values.
  if (next == null) next = {};
  if (!Array.isArray(next)) {
    next = { ...next };
    for (const key of ['mixing_engineer', 'mastering_engineer', 'executive_producer']) {
      if (typeof patch[key] === 'string' && patch[key].trim()) next[key] = patch[key];
    }
    if (Object.hasOwn(patch, 'isrc')) next.isrc = optionalIdentifier(patch.isrc, 'ISRC');
  }
  return next;
}

export function metadataPatch(existing, patch, keys) {
  const next = { ...(existing || {}) };
  for (const key of keys) if (Object.hasOwn(patch, key)) next[key] = patch[key];
  return next;
}
