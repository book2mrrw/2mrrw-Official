/**
 * Shared constants and validators for the Release Visual Layer.
 * This module is safe to import on both client and server.
 */

export const VISUAL_ASSET_TYPES = /** @type {const} */ ([
  'animated_cover',
  'visualizer',
  'music_video_moment',
  'music_video',
  'interview_clip',
  'podcast_clip',
  'studio_footage',
  'bts',
  'performance',
  'custom_visual',
]);

export const VISUAL_PLAYBACK_MODES = /** @type {const} */ (['synced', 'independent']);

export const VISUAL_INTERACTIONS = /** @type {const} */ ([
  'hold',
  'hold_swipe',
  'modal',
  'full_visual',
  'auto',
]);

// Entitlement tier ordering (higher index = more restricted)
export const VISUAL_ENTITLEMENT_TIERS = /** @type {const} */ ([
  'public',
  'signed_in',
  'purchaser',
  'subscriber',
  'collector',
  'vault',
  'admin',
]);

/**
 * Returns true when the user's resolved tier satisfies the asset's entitlement requirement.
 * @param {string} userTier — the user's resolved tier from resolveVisualEntitlementTier()
 * @param {string} assetEntitlement — the asset's required tier
 */
export function visualEntitlementSatisfied(userTier, assetEntitlement) {
  const userIdx = VISUAL_ENTITLEMENT_TIERS.indexOf(userTier);
  const assetIdx = VISUAL_ENTITLEMENT_TIERS.indexOf(assetEntitlement);
  if (userIdx === -1 || assetIdx === -1) return false;
  return userIdx >= assetIdx;
}

/**
 * Map an accountState (from AuthContext) to a visual entitlement tier string.
 * @param {object} accountState
 */
export function resolveVisualEntitlementTier(accountState) {
  if (!accountState) return 'public';
  if (accountState.isAdmin || accountState.email === 'book2mrrw@gmail.com') return 'admin';
  if (accountState.collectorCard) return 'collector';
  if (accountState.vaultAccess) return 'vault';
  if (accountState.subscriberActive || accountState.membership?.active) return 'subscriber';
  // Purchaser: has owned slugs in library
  if (accountState.userId && (accountState.ownedSlugs?.length || accountState.library?.length)) return 'purchaser';
  if (accountState.userId) return 'signed_in';
  return 'public';
}

/** Labels for display in admin UI */
export const ASSET_TYPE_LABELS = {
  animated_cover:      'Animated Cover',
  visualizer:          'Visualizer',
  music_video_moment:  'Music Video Moment',
  music_video:         'Music Video (Full)',
  interview_clip:      'Interview Clip',
  podcast_clip:        'Podcast Clip',
  studio_footage:      'Studio Footage',
  bts:                 'Behind the Scenes',
  performance:         'Performance',
  custom_visual:       'Custom Visual',
};

export const PLAYBACK_MODE_LABELS = {
  synced:      'Synced to song (music video / visualizer)',
  independent: 'Independent (interview / podcast / BTS)',
};

export const INTERACTION_LABELS = {
  hold:        'Press & Hold artwork',
  hold_swipe:  'Hold + Swipe Up to expand',
  modal:       'Opens in Modal',
  full_visual: 'Full Visual Experience',
  auto:        'Automatic',
};

export const ENTITLEMENT_LABELS = {
  public:     'Everyone (public)',
  signed_in:  'Signed In',
  purchaser:  'Purchaser (owns this release)',
  subscriber: 'Subscriber',
  collector:  'Collector Card',
  vault:      'Vault Access',
  admin:      'Admin Only',
};
