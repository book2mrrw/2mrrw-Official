/**
 * @2mrrw/config — shared platform constants, env keys, and feature flags.
 *
 * Runtime-safe: no Node.js built-ins, no browser globals.
 * Both apps/web and apps/mobile import from this package.
 */

import type { AccessTier } from '@2mrrw/types';

// ─── Preview / Playback Limits ────────────────────────────────────────────────

/** Hard cap for ENTRY-tier preview playback (seconds). */
export const PREVIEW_HARD_CAP_SEC = 30;

/** Fade-out begins this many seconds before the preview cap. */
export const PREVIEW_FADE_LEAD_SEC = 2;

// ─── Access Tier Priority ────────────────────────────────────────────────────

/**
 * Tier priority — higher index = higher privilege.
 * Admin is always resolved separately; never falls through this list.
 */
export const ACCESS_TIER_PRIORITY: AccessTier[] = [
  'discovery',
  'purchaser',
  'subscriber',
  'collector',
  'admin',
];

export function compareTiers(a: AccessTier, b: AccessTier): number {
  return ACCESS_TIER_PRIORITY.indexOf(a) - ACCESS_TIER_PRIORITY.indexOf(b);
}

export function maxTier(a: AccessTier, b: AccessTier): AccessTier {
  return compareTiers(a, b) >= 0 ? a : b;
}

// ─── Environment Variable Keys ────────────────────────────────────────────────

/**
 * Canonical list of environment variable names used by the platform.
 * Import this instead of inlining string literals to catch typos at build time.
 */
export const ENV_KEYS = {
  // Supabase
  SUPABASE_URL: 'NEXT_PUBLIC_SUPABASE_URL',
  SUPABASE_ANON_KEY: 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  SUPABASE_SERVICE_KEY: 'SUPABASE_SECRET_KEY',

  // Cloudflare R2
  R2_ENDPOINT: 'CLOUDFLARE_R2_ENDPOINT',
  R2_ACCESS_KEY_ID: 'CLOUDFLARE_R2_ACCESS_KEY_ID',
  R2_SECRET_ACCESS_KEY: 'CLOUDFLARE_R2_SECRET_ACCESS_KEY',
  R2_BUCKET_NAME: 'CLOUDFLARE_R2_BUCKET_NAME',
  R2_PUBLIC_URL: 'NEXT_PUBLIC_R2_PUBLIC_URL',

  // Stripe
  STRIPE_SECRET_KEY: 'STRIPE_SECRET_KEY',
  STRIPE_WEBHOOK_SECRET: 'STRIPE_WEBHOOK_SECRET',
  STRIPE_PUBLISHABLE_KEY: 'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY',

  // HLS / Stream
  HLS_TOKEN_SECRET: 'HLS_TOKEN_SECRET',
  HLS_SIGNING_SECRET: 'HLS_SIGNING_SECRET',

  // Auth / Admin
  ADMIN_USER_ID: 'ADMIN_USER_ID',
  ADMIN_EMAIL: 'ADMIN_EMAIL',

  // Push
  WEB_PUSH_PUBLIC_KEY: 'NEXT_PUBLIC_VAPID_PUBLIC_KEY',
  WEB_PUSH_PRIVATE_KEY: 'VAPID_PRIVATE_KEY',
  WEB_PUSH_EMAIL: 'VAPID_EMAIL',

  // Analytics
  POSTHOG_KEY: 'NEXT_PUBLIC_POSTHOG_KEY',
  SENTRY_DSN: 'NEXT_PUBLIC_SENTRY_DSN',
} as const;

export type EnvKey = typeof ENV_KEYS[keyof typeof ENV_KEYS];

// ─── Feature Flags ────────────────────────────────────────────────────────────

/**
 * Static feature flag names. Actual evaluation happens in apps/web
 * via the feature-flags module — this package only names them.
 */
export const FEATURE_FLAGS = {
  DIRECT_PREVIEW_CDN: 'direct_preview_cdn',
  CROSSFADE: 'crossfade',
  HLS_STREAM: 'hls_stream',
  CS_MODE: 'cs_mode',
} as const;

export type FeatureFlag = typeof FEATURE_FLAGS[keyof typeof FEATURE_FLAGS];

// ─── Platform Identity ────────────────────────────────────────────────────────

export const PLATFORM = {
  ARTIST: '2MRRW',
  DEFAULT_ARTIST_SLUG: '2mrrw',
} as const;

// ─── Stream Source Classification ─────────────────────────────────────────────

export const STREAM_SOURCE = {
  LIBRARY: 'library',
  PREVIEW_CDN: 'preview-cdn',
  PREVIEW_PROXY: 'preview-proxy',
  HLS: 'hls',
  UNKNOWN: 'unknown',
} as const;

export type StreamSource = typeof STREAM_SOURCE[keyof typeof STREAM_SOURCE];
