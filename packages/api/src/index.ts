/**
 * @2mrrw/api — platform API contracts.
 *
 * Defines request/response shapes for all platform API endpoints.
 * No fetch() calls here — both apps import these types and implement
 * their own transport (Next.js API routes / React Native fetch).
 */

import type { CatalogRelease, CatalogTrack, Product, Purchase, UserProfile } from '@2mrrw/types';
import type { EntitlementSummary } from '@2mrrw/auth';

// ─── Response Envelope ────────────────────────────────────────────────────────

export interface ApiResponse<T> {
  data: T | null;
  error: string | null;
  status: number;
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  total: number;
  page: number;
  pageSize: number;
}

// ─── Catalog API ──────────────────────────────────────────────────────────────

export interface CatalogReleasesResponse {
  releases: CatalogRelease[];
}

export interface CatalogHydrateRequest {
  slugs: string[];
  userId?: string;
}

export interface CatalogHydrateResponse {
  releases: CatalogRelease[];
  tracks: CatalogTrack[];
}

// ─── Library / Playback API ───────────────────────────────────────────────────

export interface StreamResolutionRequest {
  slug: string;
  trackSlug?: string;
  force?: boolean;
}

export interface StreamResolutionResponse {
  src: string;
  expires: number;
  source: 'library' | 'preview-cdn' | 'hls';
}

export interface PlaybackKeyRequest {
  trackSlug: string;
  userId: string;
}

export interface PlaybackKeyResponse {
  token: string;
  expires: number;
}

// ─── Commerce API ─────────────────────────────────────────────────────────────

export interface CheckoutSessionRequest {
  productSlug: string;
  userId: string;
  successUrl: string;
  cancelUrl: string;
}

export interface CheckoutSessionResponse {
  sessionId: string;
  url: string;
}

export interface PurchaseHistoryResponse {
  purchases: Purchase[];
}

// ─── Account API ─────────────────────────────────────────────────────────────

export interface AccountStateResponse {
  user: UserProfile | null;
  entitlements: EntitlementSummary | null;
  purchases: Purchase[];
}

// ─── Gift API ────────────────────────────────────────────────────────────────

export interface GiftClaimRequest {
  token: string;
  userId: string;
}

export interface GiftClaimResponse {
  success: boolean;
  productSlug: string | null;
  message: string;
}

// ─── Notification API ─────────────────────────────────────────────────────────

export interface PushSubscribeRequest {
  userId: string;
  subscription: {
    endpoint: string;
    keys: { p256dh: string; auth: string };
  };
}

export interface DropNotificationRequest {
  title: string;
  body: string;
  url?: string;
  imageUrl?: string;
}

// ─── Admin API ───────────────────────────────────────────────────────────────

export interface SyncCatalogRequest {
  force?: boolean;
}

export interface SyncCatalogResponse {
  synced: number;
  errors: string[];
  durationMs: number;
}

export interface GrantEntitlementRequest {
  userId: string;
  type: 'vault_access' | 'subscriber' | 'collector_card';
  metadata?: Record<string, unknown>;
}
