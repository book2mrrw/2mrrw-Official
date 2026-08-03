import { initStripe, presentPaymentSheet, createPaymentMethod } from '@stripe/stripe-react-native';
import { supabase } from './supabase';

export async function initStripeSDK(): Promise<void> {
  await initStripe({
    publishableKey: process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY!,
    merchantIdentifier: 'merchant.com.2mrrw',
  });
}

export async function purchaseRelease(releaseSlug: string): Promise<{ success: boolean; error?: string }> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { success: false, error: 'Not signed in' };

  const res = await fetch(`${process.env.EXPO_PUBLIC_API_URL}/checkout/release`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
    body: JSON.stringify({ release_slug: releaseSlug, platform: 'mobile' }),
  });

  if (!res.ok) return { success: false, error: 'Failed to create payment session' };

  const { clientSecret, ephemeralKey, customerId } = await res.json();

  const { error } = await presentPaymentSheet({
    paymentSheetParameters: {
      paymentIntentClientSecret: clientSecret,
      customerEphemeralKeySecret: ephemeralKey,
      customerId,
      merchantDisplayName: '2MRRW',
      applePay: { merchantCountryCode: 'US' },
      googlePay: { merchantCountryCode: 'US', testEnv: process.env.NODE_ENV !== 'production' },
      style: 'alwaysDark',
    },
  });

  if (error) return { success: false, error: error.message };
  return { success: true };
}
