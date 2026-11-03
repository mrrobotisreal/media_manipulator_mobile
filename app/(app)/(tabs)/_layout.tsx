import { Tabs } from 'expo-router';
import { CircleUser, History, Wrench } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { BrandBar } from '@/ui/components';
import { colors, fonts } from '@/ui/tokens';

export default function TabsLayout() {
  const { t } = useTranslation();
  return (
    <Tabs
      screenOptions={{
        // Brand bar only (no title or actions); the tab screens pad neither edge (bar and tabs do).
        header: () => <BrandBar />,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedFg,
        tabBarStyle: { backgroundColor: colors.surface1, borderTopColor: colors.edge },
        tabBarLabelStyle: { fontFamily: fonts.ui.medium },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t('tabs.tools'),
          tabBarButtonTestID: 'tab-tools',
          tabBarIcon: ({ color, size }) => <Wrench color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: t('tabs.history'),
          tabBarButtonTestID: 'tab-history',
          tabBarIcon: ({ color, size }) => <History color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="account"
        options={{
          title: t('tabs.account'),
          tabBarButtonTestID: 'tab-account',
          tabBarIcon: ({ color, size }) => <CircleUser color={color} size={size} />,
        }}
      />
    </Tabs>
  );
}
