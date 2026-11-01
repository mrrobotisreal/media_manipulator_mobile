import { Tabs } from 'expo-router';
import { CircleUser, History, Wrench } from 'lucide-react-native';
import { colors, fonts } from '@/ui/tokens';

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedFg,
        tabBarStyle: { backgroundColor: colors.surface1, borderTopColor: colors.edge },
        tabBarLabelStyle: { fontFamily: fonts.ui.medium },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Tools', // i18n: MA05
          tabBarIcon: ({ color, size }) => <Wrench color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: 'History', // i18n: MA05
          tabBarIcon: ({ color, size }) => <History color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="account"
        options={{
          title: 'Account', // i18n: MA05
          tabBarIcon: ({ color, size }) => <CircleUser color={color} size={size} />,
        }}
      />
    </Tabs>
  );
}
