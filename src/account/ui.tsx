import { useRouter, type Href } from 'expo-router';
import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { I18nManager, Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Text } from '@/ui/components';
import { colors } from '@/ui/tokens';

/** Back arrow + title row used by every Account sub-screen. */
export function ScreenHeader({ title }: { title: string }) {
  const { t } = useTranslation();
  const router = useRouter();
  return (
    <View className="flex-row items-center gap-2 px-2 py-2">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('common.back')}
        onPress={() => router.back()}
        className="size-12 items-center justify-center"
      >
        {I18nManager.isRTL ? (
          <ChevronRight size={24} color={colors.foreground} />
        ) : (
          <ChevronLeft size={24} color={colors.foreground} />
        )}
      </Pressable>
      <Text accessibilityRole="header" className="flex-1 text-lg font-semibold">
        {title}
      </Text>
    </View>
  );
}

/** Small caps-free section label above a group of rows. */
export function SectionLabel({ children }: { children: string }) {
  return (
    <Text accessibilityRole="header" className="px-1 pb-2 pt-4 text-sm font-medium text-muted-fg">
      {children}
    </Text>
  );
}

export function Card({ children, testID }: { children: ReactNode; testID?: string }) {
  return (
    <View testID={testID} className="gap-3 rounded-lg border border-edge bg-surface-1 p-4">
      {children}
    </View>
  );
}

export function Chevron() {
  return I18nManager.isRTL ? (
    <ChevronLeft size={20} color={colors.mutedFg} />
  ) : (
    <ChevronRight size={20} color={colors.mutedFg} />
  );
}

/** A tappable row with a start-side label, optional value, and an end chevron. */
export function NavRow({
  label,
  value,
  href,
  onPress,
  danger,
  testID,
}: {
  label: string;
  value?: string;
  href?: Href;
  onPress?: () => void;
  danger?: boolean;
  testID?: string;
}) {
  const router = useRouter();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      onPress={() => (onPress ? onPress() : href ? router.push(href) : undefined)}
      className="min-h-[48px] flex-row items-center gap-3 rounded-lg border border-edge bg-surface-1 px-4 py-2"
    >
      <Text className={`flex-1 ${danger ? 'text-danger' : ''}`}>{label}</Text>
      {value ? <Text className="text-sm text-muted-fg">{value}</Text> : null}
      <Chevron />
    </Pressable>
  );
}
