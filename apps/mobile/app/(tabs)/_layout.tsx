import { Tabs } from 'expo-router';
import { Platform } from 'react-native';
import { BlurView } from 'expo-blur';
import { TabBarIcon } from '@/components/ui/TabBarIcon';
import { MiniPlayer } from '@/components/audio/MiniPlayer';
import { colors } from '@2mrrw/design-system';

export default function TabLayout() {
  return (
    <>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: colors.accent.primary,
          tabBarInactiveTintColor: colors.text.muted,
          tabBarStyle: {
            backgroundColor: Platform.OS === 'ios' ? 'transparent' : colors.background.dark,
            borderTopColor: 'rgba(255,255,255,0.06)',
            borderTopWidth: 1,
            paddingBottom: Platform.OS === 'ios' ? 28 : 8,
            paddingTop: 8,
            height: Platform.OS === 'ios' ? 84 : 64,
          },
          tabBarBackground: () =>
            Platform.OS === 'ios' ? (
              <BlurView intensity={80} tint="dark" style={{ flex: 1 }} />
            ) : null,
          tabBarLabelStyle: {
            fontFamily: 'DMMono',
            fontSize: 10,
            letterSpacing: 0.5,
          },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: 'Home',
            tabBarIcon: ({ color, focused }) => (
              <TabBarIcon name={focused ? 'home' : 'home-outline'} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="releases"
          options={{
            title: 'Releases',
            tabBarIcon: ({ color, focused }) => (
              <TabBarIcon name={focused ? 'disc' : 'disc-outline'} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="library"
          options={{
            title: 'Library',
            tabBarIcon: ({ color, focused }) => (
              <TabBarIcon name={focused ? 'library' : 'library-outline'} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="profile"
          options={{
            title: 'Profile',
            tabBarIcon: ({ color, focused }) => (
              <TabBarIcon name={focused ? 'person' : 'person-outline'} color={color} />
            ),
          }}
        />
      </Tabs>
      <MiniPlayer />
    </>
  );
}
