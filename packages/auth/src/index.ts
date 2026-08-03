/**
 * @2mrrw/auth — authentication contracts and shared auth logic.
 *
 * Defines the interfaces that both apps/web (Supabase SSR) and
 * apps/mobile (Supabase React Native) implement.
 * No platform-specific imports.
 */

import type { UserProfile, AccountState, EntitlementType } from '@2mrrw/types';

// ─── Session ─────────────────────────────────────────────────────────────────

export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  userId: string;
  email: string | null;
}

export interface AuthUser {
  id: string;
  email: string | null;
  role: 'user' | 'admin';
  /** Raw app_metadata.role from Supabase. */
  supabaseRole?: string | null;
}

// ─── Auth State Machine ───────────────────────────────────────────────────────

export type AuthStatus =
  | 'initializing'
  | 'authenticated'
  | 'unauthenticated'
  | 'loading';

export interface AuthState {
  status: AuthStatus;
  user: AuthUser | null;
  session: AuthSession | null;
  error: string | null;
}

// ─── Auth Provider Contract ───────────────────────────────────────────────────

/**
 * Platform-agnostic auth provider interface.
 * apps/web implements via @supabase/ssr.
 * apps/mobile implements via @supabase/supabase-js + AsyncStorage.
 */
export interface AuthProvider {
  getSession(): Promise<AuthSession | null>;
  getUser(): Promise<AuthUser | null>;
  signInWithEmail(email: string, password: string): Promise<AuthSession>;
  signInWithPhone(phone: string, otp: string): Promise<AuthSession>;
  signOut(): Promise<void>;
  refreshSession(): Promise<AuthSession | null>;
  onAuthStateChange(
    callback: (event: AuthEvent, session: AuthSession | null) => void
  ): () => void;
}

export type AuthEvent =
  | 'SIGNED_IN'
  | 'SIGNED_OUT'
  | 'TOKEN_REFRESHED'
  | 'USER_UPDATED'
  | 'PASSWORD_RECOVERY';

// ─── Entitlement Resolution ───────────────────────────────────────────────────

export interface EntitlementSummary {
  userId: string;
  types: EntitlementType[];
  hasSubscription: boolean;
  hasCollectorCard: boolean;
  hasVaultAccess: boolean;
  ownedProductSlugs: string[];
  resolvedAt: number;
}

/** Returns true when the user is the platform admin. */
export function isAdmin(user: Pick<AuthUser, 'id' | 'email' | 'role'> | null, adminEmail: string, adminUserId: string): boolean {
  if (!user) return false;
  if (user.id === adminUserId) return true;
  if (user.role === 'admin') return true;
  const norm = String(user.email || '').trim().toLowerCase();
  return Boolean(norm && norm === adminEmail.toLowerCase());
}

/** Derives a UserProfile from raw auth + entitlement data. */
export function buildUserProfile(
  user: AuthUser,
  entitlements: EntitlementSummary
): UserProfile {
  return {
    id: user.id,
    email: user.email,
    displayName: null,
    avatarUrl: null,
    role: user.role,
    hasSubscription: entitlements.hasSubscription,
    hasCollectorCard: entitlements.hasCollectorCard,
    hasVaultAccess: entitlements.hasVaultAccess,
    ownedSlugs: new Set(entitlements.ownedProductSlugs),
  };
}
