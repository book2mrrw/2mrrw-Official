import { editableCreditGroups, validateCreditGroups, optionalIdentifier } from './contract';

/** Fail closed until the reviewed database contract reports its own capabilities. */
export async function creditStorageCapabilities(admin) {
  const { data, error } = await admin.rpc('credit_storage_capabilities');
  return !error && data?.version === 1 && data?.private_allocations === true && data?.service_role_only === true
    ? { ready: true, version: 1 }
    : { ready: false, reason: 'Credit editing requires the reviewed database contract. Existing values remain available.' };
}

export async function loadEditableRelease(admin, id) {
  const { data: release, error: releaseError } = await admin.from('releases').select('*').eq('id', id).is('deleted_at', null).maybeSingle();
  if (releaseError) throw releaseError;
  const query = admin.from('products').select('*');
  const { data: product, error: productError } = await (release ? query.eq('release_id', id).is('deleted_at', null) : query.eq('id', id).is('deleted_at', null)).maybeSingle();
  if (productError) throw productError;
  if (!release && !product) return null;
  const source = release ? 'releases' : 'catalog';
  const [{ data: tracks, error: tracksError }, { data: catalogTracks, error: catalogError }] = await Promise.all([
    release ? admin.from('tracks').select('*').eq('release_id', id).is('removed_from_release_at', null).order('position', { ascending: true }) : { data: [] },
    product ? admin.from('catalog_tracks').select('*').eq('product_id', product.id).is('removed_from_release_at', null).order('position', { ascending: true }) : { data: [] },
  ]);
  if (tracksError || catalogError) throw tracksError || catalogError;
  const capabilities = await creditStorageCapabilities(admin);
  let stored = [];
  if (capabilities.ready) {
    const response = await admin.rpc('get_release_credit_edit_state', { p_release_ref_id: id });
    if (response.error) throw response.error;
    stored = response.data || [];
  }
  const creditGroups = (scope, targetId, fallback) => ({ ...editableCreditGroups(fallback), ...(stored.find(row => row.scope === scope && row.target_id === targetId)?.groups || {}) });
  const releaseSource = product || release;
  const meta = product?.metadata || {};
  const rmeta = release?.metadata || {};
  const type = release?.release_type || meta.release_category || ({ singles: 'single', features: 'feature', albums: 'album' })[product?.release_type] || product?.product_type;
  const sourceTracks = release ? tracks || [] : catalogTracks || [];
  const rows = sourceTracks.map(t => {
    const projection = release ? (catalogTracks || []).find(c => c.track_id === t.id) : t;
    const savedCredits = t.draft_data?.public_credits != null ? { ...t, credits: t.draft_data.public_credits } : projection?.credits != null ? { ...t, credits: projection.credits } : t;
    return {
      id: t.id, slug: t.slug || projection?.slug || null, title: t.title || '', position: t.position ?? t.track_number,
      lyrics: t.lyrics ?? t.metadata?.lyrics ?? '', isrc: t.isrc ?? projection?.credits?.isrc ?? t.metadata?.isrc ?? '',
      credits: savedCredits.credits || null, credit_groups: creditGroups('recording', t.id, savedCredits),
      inherit_credits: (t.draft_data?.inherit_credits ?? t.metadata?.inherit_credits) === true,
      audio_r2_key: t.audio_r2_key || null, upload_status: t.upload_status || 'ready', has_audio: !!(t.audio_r2_key || t.storage_path),
    };
  });
  return {
    source, capabilities,
    revision: { release: release?.updated_at || null, product: product?.updated_at || null, tracks: Object.fromEntries(sourceTracks.map(t => [t.id, t.updated_at || null])), credits: stored.map(g => ({ id: g.id, revision: g.revision })) },
    release: {
      id: release?.id || product.id, slug: release?.slug || product.slug,
      status: release?.status || (product.active ? 'published' : 'draft'), release_type: type,
      release_date: release?.release_date ?? product?.release_date ?? meta.release_date ?? '',
      upc: release?.upc ?? meta.upc ?? '', artist: meta.artist || rmeta.artist || '',
      credits: releaseSource?.credits || null, credit_groups: creditGroups('release', release?.id || product.id, releaseSource),
      cover_art_r2_key: release?.cover_art_r2_key || meta.cover_art_r2_key || product?.cover_url || null,
      animated_cover_r2_key: rmeta.animated_cover_r2_key || meta.animated_cover_r2_key || null,
      ...Object.fromEntries(['scheduled_at','available_at','release_timezone','storefront_visible','upcoming_visible','preview_before_release','preorder_enabled','preorder_starts_at','preorder_price_cents','early_access_enabled','early_access_starts_at','early_access_scope','early_access_audiences','unavailable_at'].map(k => [k, release?.[k] ?? null])),
    },
    product: { title: product?.title || release?.title || rmeta.draft_title || '', display_title: product?.display_title || product?.title || '', price_cents: product?.price_cents ?? null, genre: meta.genre || '' },
    tracks: rows,
  };
}

export function validateCreditEdit(body) {
  const errors = [];
  if (Object.hasOwn(body, 'credit_groups')) errors.push(...validateCreditGroups(body.credit_groups));
  if (Object.hasOwn(body, 'upc')) try { optionalIdentifier(body.upc, 'UPC/EAN'); } catch (error) { errors.push(error.message); }
  if (Object.hasOwn(body, 'recordings') && !Array.isArray(body.recordings)) errors.push('Recordings must be a list.');
  const seen = new Set();
  for (const track of Array.isArray(body.recordings) ? body.recordings : []) {
    if (!track || typeof track !== 'object' || Array.isArray(track)) { errors.push('Invalid recording.'); continue; }
    if (!track?.id || seen.has(track.id)) errors.push('Each recording must have a unique saved identity.');
    seen.add(track?.id);
    if (Object.hasOwn(track, 'credit_groups')) errors.push(...validateCreditGroups(track.credit_groups).map(e => `${track.id}: ${e}`));
    if (Object.hasOwn(track, 'isrc')) try { optionalIdentifier(track.isrc, 'ISRC'); } catch (error) { errors.push(error.message); }
  }
  if (!body.revision || typeof body.revision !== 'object' || Array.isArray(body.revision)) errors.push('Reload the release before saving: a saved revision is required.');
  return errors;
}

export async function commitCreditEdit(admin, id, body) {
  const errors = validateCreditEdit(body);
  if (errors.length) return { status: 422, body: { error: errors.join(' '), errors } };
  const capability = await creditStorageCapabilities(admin);
  if (!capability.ready) return { status: 503, body: { error: capability.reason } };
  const { data, error } = await admin.rpc('commit_release_credit_edit', { p_release_ref_id: id, p_expected_revision: body.revision, p_patch: body });
  if (error) return { status: error.code === '40001' ? 409 : error.code === '22023' ? 422 : 500, body: { error: error.code === '40001' ? 'This release changed. Reload it before saving; your entered values have been retained.' : error.code === '22023' ? error.message : 'The release could not be saved. No partial credit update was committed.' } };
  return { status: 200, body: { ok: true, revision: data?.revision }, result: data };
}
