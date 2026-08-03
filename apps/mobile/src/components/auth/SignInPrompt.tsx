import { View, Text, Pressable, Linking } from 'react-native';
import { colors } from '@2mrrw/design-system';

export function SignInPrompt() {
  const handleSignIn = () => {
    Linking.openURL('2mrrw://auth/sign-in');
  };

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40 }}>
      <Text
        style={{
          color: colors.foreground.dark,
          fontFamily: 'CormorantGaramond',
          fontSize: 28,
          textAlign: 'center',
          marginBottom: 8,
        }}
      >
        Your Library
      </Text>
      <Text
        style={{
          color: colors.text.muted,
          fontFamily: 'DMMono',
          fontSize: 12,
          textAlign: 'center',
          lineHeight: 20,
          marginBottom: 28,
        }}
      >
        Sign in to access your purchased music and exclusive content.
      </Text>
      <Pressable
        onPress={handleSignIn}
        style={{
          backgroundColor: colors.foreground.dark,
          paddingHorizontal: 28,
          paddingVertical: 12,
          borderRadius: 24,
        }}
      >
        <Text
          style={{
            color: colors.background.dark,
            fontFamily: 'DMMono',
            fontSize: 13,
          }}
        >
          Sign In
        </Text>
      </Pressable>
    </View>
  );
}
