import { useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { colors } from '@2mrrw/design-system';

export default function AuthCallbackScreen() {
  const params = useLocalSearchParams<{ access_token?: string; refresh_token?: string }>();

  useEffect(() => {
    const { access_token, refresh_token } = params;
    if (access_token && refresh_token) {
      supabase.auth.setSession({ access_token, refresh_token }).then(() => {
        router.replace('/(tabs)');
      });
    } else {
      router.replace('/auth/sign-in');
    }
  }, [params]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background.dark, alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator color={colors.foreground.dark} />
    </View>
  );
}
