import { ScrollView, View, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '@/stores/auth-store';
import { LibraryList } from '@/components/library/LibraryList';
import { SignInPrompt } from '@/components/auth/SignInPrompt';

export default function LibraryScreen() {
  const user = useAuthStore((s) => s.user);

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      <View className="px-5 pt-4 pb-3">
        <Text className="font-mono text-muted text-xs tracking-widest uppercase">
          My Music
        </Text>
        <Text className="font-display text-foreground text-3xl mt-1">
          Library
        </Text>
      </View>
      {user ? <LibraryList userId={user.id} /> : <SignInPrompt />}
    </SafeAreaView>
  );
}
