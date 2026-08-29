/**
 * @2mrrw/types — canonical domain type contracts.
 *
 * No runtime code. No framework dependencies. No implementation.
 * Both apps/web (JS) and apps/mobile (TS) conform to these shapes.
 */

// ─── Entitlement ─────────────────────────────────────────────────────────────

export type EntitlementType = 'vault_access' | 'subscriber' | 'collector_card';

/**
 * Resolved playback access tier for a user × track combination.
 * Priority: admin > collector > subscriber > purchaser > discovery.
 */
export type AccessTier =
  | 'admin'
  | 'collector'
  | 'subscriber'
  | 'purchaser'
  | 'discovery';

export interface AccessGrant {
  canStream: boolean;
  previewOnly: boolean;
  tier: AccessTier;
  owned?: boolean;
  subscription?: boolean;
  collector?: boolean;
}

// ─── Track ───────────────────────────────────────────────────────────────────

export type CoverArtType = 'image' | 'video';

export interface TrackMetadata {
  trackSlug?: string | null;
  releaseSlug?: string | null;
  albumSlug?: string | null;
  access?: AccessGrant;
  previewSrc?: string | null;
  previewPath?: string | null;
  gainDb?: number | null;
  [key: string]: unknown;
}

/**
 * Normalized playback track — the single canonical shape consumed by
 * AudioContext, the queue system, and the native audio engine.
 */
export interface Track {
  id: string;
  slug: string;
  title: string;
  artist: string;
  cover: string | null;
  baseCover: string | null;
  src: string;
  baseSrc: string;
  coverArtType: CoverArtType;
  csAudio: string | null;
  csCover: string | null;
  csCoverType: CoverArtType;
  hasCs: boolean;
  gainDb: number | null;
  source: string;
  metadata: TrackMetadata;
  preview: string | null;
}

// ─── Queue ───────────────────────────────────────────────────────────────────

export type RepeatMode = 'off' | 'one' | 'all';

export interface QueueState {
  tracks: Track[];
  index: number;
  repeat: RepeatMode;
  shuffle: boolean;
}

// ─── Playback State ──────────────────────────────────────────────────────────

export type PlaybackLifecycleState =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'playing'
  | 'paused'
  | 'recovering'
  | 'ending'
  | 'ended_preview';

export type PlaybackNetworkState =
  | 'idle'
  | 'loading_stream'
  | 'buffering'
  | 'playing'
  | 'recovering'
  | 'retrying_stream'
  | 'error_stream';

export interface PlaybackState {
  currentTrack: Track | null;
  currentTrackId: string | null;
  isPlaying: boolean;
  isBuffering: boolean;
  hasStarted: boolean;
  currentTime: number;
  duration: number;
  error: string | null;
  playbackState: PlaybackLifecycleState;
  playbackNetworkState: PlaybackNetworkState;
  csMode: boolean;
  accessDenied: boolean;
  streamRetryable: boolean;
  source?: string | null;
  mediaSessionPlaybackState?: 'playing' | 'paused' | 'none' | null;
}

// ─── User ────────────────────────────────────────────────────────────────────

export interface UserProfile {
  id: string;
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  role: 'user' | 'admin';
  hasSubscription: boolean;
  hasCollectorCard: boolean;
  hasVaultAccess: boolean;
  ownedSlugs: Set<string>;
}

export interface AccountState {
  user: UserProfile | null;
  loading: boolean;
  error: string | null;
}

// ─── Release / Catalog ───────────────────────────────────────────────────────

export type ReleaseType =
  | 'album'
  | 'ep'
  | 'mixtape'
  | 'single'
  | 'feature'
  | 'vault'
  | 'exclusive';

export interface CatalogRelease {
  id: string;
  slug: string;
  title: string;
  artist: string;
  cover: string | null;
  baseCover?: string | null;
  video?: string | null;
  coverArtType: CoverArtType;
  type: ReleaseType;
  releaseDate: string | null;
  tracks: CatalogTrack[];
  metadata?: Record<string, unknown>;
}

export interface CatalogTrack {
  id: string;
  slug: string;
  title: string;
  artist: string;
  trackNumber: number | null;
  duration: number | null;
  preview: string | null;
  src: string | null;
  cover: string | null;
  gainDb: number | null;
  metadata?: TrackMetadata;
}

// ─── Commerce ────────────────────────────────────────────────────────────────

export type ProductType = 'digital' | 'vinyl' | 'merch' | 'bundle';

export interface Product {
  id: string;
  slug: string;
  name: string;
  type: ProductType;
  price: number;
  currency: string;
  stripePriceId: string | null;
  coverUrl: string | null;
}

export interface Purchase {
  id: string;
  productId: string;
  productSlug: string;
  userId: string;
  createdAt: string;
}

// ─── Push Notifications ──────────────────────────────────────────────────────

export interface PushSubscriptionRecord {
  userId: string;
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

// ─── Utility ─────────────────────────────────────────────────────────────────

export type Nullable<T> = T | null;
export type Maybe<T> = T | null | undefined;
export type AsyncResult<T> = Promise<
  { data: T; error: null } | { data: null; error: Error }
>;
