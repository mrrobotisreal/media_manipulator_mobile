import { Check, ChevronLeft, ChevronRight } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { I18nManager, Pressable, ScrollView, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { setAppLocale } from '@/i18n/setAppLocale';
import { locales } from '@/i18n/locales';
import { resolveLocale } from '@/i18n/resolveLocale';
import { persistor, store } from '@/state/store';
import { useAppSelector } from '@/state/hooks';
import { Button, Screen, Sheet, Text } from '@/ui/components';
import { colors } from '@/ui/tokens';
import * as Localization from 'expo-localization';

function Row({
  title,
  subtitle,
  selected,
  onPress,
}: {
  title: string;
  subtitle?: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onPress}
      className="min-h-[48px] flex-row items-center gap-3 border-b border-edge px-4 py-2"
    >
      <View className="flex-1">
        <Text>{title}</Text>
        {subtitle ? <Text className="text-sm text-muted-fg">{subtitle}</Text> : null}
      </View>
      {selected ? <Check size={20} color={colors.primary} /> : null}
    </Pressable>
  );
}

export default function LanguageScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const override = useAppSelector((s) => s.settings.locale);
  const [pendingRtl, setPendingRtl] = useState<boolean | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const confirmRestart = useCallback(
    (nextIsRtl: boolean) =>
      new Promise<boolean>((resolve) => {
        resolver.current = resolve;
        setPendingRtl(nextIsRtl);
      }),
    [],
  );
  const answer = (ok: boolean) => {
    setPendingRtl(null);
    resolver.current?.(ok);
    resolver.current = null;
  };

  const choose = (code: string | null) => {
    if (code === override) return;
    void setAppLocale(code, {
      dispatch: store.dispatch,
      getState: store.getState,
      confirmRestart,
      flush: () => persistor.flush(),
    });
  };

  return (
    <Screen>
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
        <Text className="text-lg font-semibold">{t('language.title')}</Text>
      </View>
      <ScrollView accessibilityRole="radiogroup">
        <Row
          title={t('language.system')}
          subtitle={
            locales.find((l) => l.code === resolveLocale(null, Localization.getLocales()))?.label
          }
          selected={override === null}
          onPress={() => choose(null)}
        />
        {locales.map((l) => (
          <Row
            key={l.code}
            title={l.label}
            subtitle={l.englishLabel}
            selected={override === l.code}
            onPress={() => choose(l.code)}
          />
        ))}
      </ScrollView>
      <Sheet visible={pendingRtl !== null} onClose={() => answer(false)}>
        <View className="gap-3">
          <Text className="text-lg font-semibold">{t('language.rtlReloadTitle')}</Text>
          <Text className="text-muted-fg">
            {pendingRtl ? t('language.rtlReloadBody') : t('language.rtlReloadBodyLtr')}
          </Text>
          <Button label={t('language.rtlReloadConfirm')} onPress={() => answer(true)} />
          <Button label={t('common.cancel')} variant="ghost" onPress={() => answer(false)} />
        </View>
      </Sheet>
    </Screen>
  );
}
