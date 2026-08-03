import { useState } from 'react';
import { View, Text, TextInput, Pressable, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { colors } from '@2mrrw/design-system';

export default function SignInScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSignIn = async () => {
    setError(null);
    setLoading(true);
    try {
      const { error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (authError) { setError(authError.message); return; }
      router.replace('/(tabs)');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.background.dark }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 32 }}>
        <Text style={{ color: colors.foreground.dark, fontFamily: 'CormorantGaramond', fontSize: 40, letterSpacing: -1, marginBottom: 8 }}>
          2MRRW
        </Text>
        <Text style={{ color: colors.text.muted, fontFamily: 'DMMono', fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', marginBottom: 48 }}>
          Sign In
        </Text>

        {error && (
          <View style={{ backgroundColor: 'rgba(239,68,68,0.1)', borderWidth: 1, borderColor: 'rgba(239,68,68,0.3)', borderRadius: 8, padding: 12, marginBottom: 20 }}>
            <Text style={{ color: '#f87171', fontFamily: 'DMMono', fontSize: 12 }}>{error}</Text>
          </View>
        )}

        <TextInput
          value={email}
          onChangeText={setEmail}
          placeholder="Email"
          placeholderTextColor={colors.text.muted}
          autoCapitalize="none"
          keyboardType="email-address"
          style={{
            backgroundColor: 'rgba(255,255,255,0.05)',
            borderWidth: 1,
            borderColor: 'rgba(255,255,255,0.1)',
            borderRadius: 8,
            paddingHorizontal: 16,
            paddingVertical: 14,
            color: colors.foreground.dark,
            fontFamily: 'DMMono',
            fontSize: 14,
            marginBottom: 12,
          }}
        />

        <TextInput
          value={password}
          onChangeText={setPassword}
          placeholder="Password"
          placeholderTextColor={colors.text.muted}
          secureTextEntry
          style={{
            backgroundColor: 'rgba(255,255,255,0.05)',
            borderWidth: 1,
            borderColor: 'rgba(255,255,255,0.1)',
            borderRadius: 8,
            paddingHorizontal: 16,
            paddingVertical: 14,
            color: colors.foreground.dark,
            fontFamily: 'DMMono',
            fontSize: 14,
            marginBottom: 28,
          }}
        />

        <Pressable
          onPress={handleSignIn}
          disabled={loading}
          style={({ pressed }) => ({
            backgroundColor: pressed ? 'rgba(255,255,255,0.9)' : colors.foreground.dark,
            borderRadius: 8,
            paddingVertical: 16,
            alignItems: 'center',
            opacity: loading ? 0.6 : 1,
          })}
        >
          {loading
            ? <ActivityIndicator color={colors.background.dark} />
            : <Text style={{ color: colors.background.dark, fontFamily: 'DMMono', fontSize: 14 }}>Sign In</Text>
          }
        </Pressable>

        <Pressable onPress={() => router.push('/auth/sign-up')} style={{ marginTop: 20, alignItems: 'center' }}>
          <Text style={{ color: colors.text.muted, fontFamily: 'DMMono', fontSize: 12 }}>
            No account? <Text style={{ color: colors.foreground.dark }}>Sign Up</Text>
          </Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}
