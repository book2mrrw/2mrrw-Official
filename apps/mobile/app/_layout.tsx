import '../src/lib/sentry';
import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { QueryClientProvider } from '@tanstack/react-query';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { StripeProvider } from '@stripe/stripe-react-native';
import { queryClient } from '@/lib/query-client';
import { AudioProvider } from '@/audio/AudioProvider';
import { AuthProvider } from '@/providers/AuthProvider';
import { useFonts } from '@/hooks/useFonts';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const fontsLoaded = useFonts();

  useEffect(() => {
    if (fontsLoaded) SplashScreen.hideAsync();
  }, [fontsLoaded]);

  if (!fontsLoaded) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <StripeProvider publishableKey={process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY!} merchantIdentifier="merchant.com.2mrrw">
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <AudioProvider>
            <StatusBar style="light" />
            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Screen name="(tabs)" />
              <Stack.Screen
                name="player"
                options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
              />
              <Stack.Screen
                name="release/[slug]"
                options={{ animation: 'slide_from_right' }}
              />
              <Stack.Screen name="auth/sign-in" options={{ animation: 'slide_from_bottom' }} />
              <Stack.Screen name="auth/sign-up" options={{ animation: 'slide_from_bottom' }} />
              <Stack.Screen name="auth/callback" options={{ headerShown: false }} />
            </Stack>
          </AudioProvider>
        </AuthProvider>
      </QueryClientProvider>
      </StripeProvider>
    </GestureHandlerRootView>
  );
}
