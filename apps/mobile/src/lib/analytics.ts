import PostHog from 'posthog-react-native';

const isDev = process.env.NODE_ENV === 'development';

export const posthog = new PostHog(process.env.EXPO_PUBLIC_POSTHOG_KEY!, {
  host: process.env.EXPO_PUBLIC_POSTHOG_HOST ?? 'https://app.posthog.com',
  disabled: isDev,
  captureAppLifecycleEvents: true,
});

export function trackPlay(trackId: string, source: string) {
  posthog.capture('track_play', { track_id: trackId, source });
}

export function trackPurchaseIntent(releaseSlug: string) {
  posthog.capture('purchase_intent', { release_slug: releaseSlug });
}

export function trackPurchaseComplete(releaseSlug: string, amount: number) {
  posthog.capture('purchase_complete', { release_slug: releaseSlug, amount });
}

export function identifyUser(userId: string, props: Record<string, unknown>) {
  posthog.identify(userId, props);
}

export function resetUser() {
  posthog.reset();
}
