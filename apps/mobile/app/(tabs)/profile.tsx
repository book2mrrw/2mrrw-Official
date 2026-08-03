import { ScrollView, View, Text, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '@/stores/auth-store';
import { EntitlementBadges } from '@/components/profile/EntitlementBadges';
import { PurchaseHistory } from '@/components/profile/PurchaseHistory';

export default function ProfileScreen() {
  const { user, signOut } = useAuthStore();

  if (!user) {
    return (
      <SafeAreaView className="flex-1 bg-background items-center justify-center" edges={['top']}>
        <Text className="font-display text-foreground text-2xl mb-2">Sign In</Text>
        <Text className="font-mono text-muted text-sm text-center px-8">
          Sign in to access your library, purchases, and exclusive content.
        </Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingBottom: 140 }}>
        <View className="px-5 pt-4 pb-6">
          <Text className="font-mono text-muted text-xs tracking-widest uppercase">
            Account
          </Text>
          <Text className="font-display text-foreground text-3xl mt-1">
            {user.displayName ?? user.email ?? 'Profile'}
          </Text>
        </View>

        <EntitlementBadges user={user} />
        <PurchaseHistory userId={user.id} />

        <Pressable
          onPress={signOut}
          className="mx-5 mt-8 py-3 rounded-lg border border-white/10 items-center"
        >
          <Text className="font-mono text-muted text-sm">Sign Out</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
