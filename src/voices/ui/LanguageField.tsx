import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';
import { languageName } from '@/tools/forms/ai/languages';
import { useActiveLocale } from '@/i18n/useActiveLocale';
import { Button } from '@/ui/components/Button';
import { Sheet } from '@/ui/components/Sheet';
import { Text } from '@/ui/components/Text';
import { colors, hitTarget } from '@/ui/tokens';

/** A labelled language picker: a row showing the current language, a sheet listing the offered codes. */
export function LanguageField({
  label,
  value,
  options,
  onChange,
  hint,
  testID,
}: {
  label: string;
  value: string;
  options: readonly string[];
  onChange: (code: string) => void;
  hint?: string;
  testID?: string;
}) {
  const { t } = useTranslation();
  const locale = useActiveLocale();
  const [open, setOpen] = useState(false);
  return (
    <View className="gap-2">
      <Text className="text-sm text-muted-fg">{label}</Text>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${languageName(value, locale)}`}
        onPress={() => setOpen(true)}
        className="flex-row items-center justify-between rounded-md border border-edge-control bg-surface-1 px-3"
        style={{ minHeight: hitTarget }}
      >
        <Text>{languageName(value, locale)}</Text>
        <Text className="text-sm text-muted-fg">{value}</Text>
      </Pressable>
      {hint ? <Text className="text-sm text-subtle">{hint}</Text> : null}
      <Sheet visible={open} onClose={() => setOpen(false)}>
        <View className="gap-2">
          <Text className="text-lg font-semibold">{label}</Text>
          <ScrollView style={{ maxHeight: 360 }}>
            {options.map((code) => (
              <Pressable
                key={code}
                testID={`lang-${code}`}
                accessibilityRole="radio"
                accessibilityState={{ selected: code === value }}
                onPress={() => {
                  onChange(code);
                  setOpen(false);
                }}
                className="flex-row items-center justify-between px-1"
                style={{ minHeight: hitTarget }}
              >
                <Text className={code === value ? 'font-semibold' : ''}>
                  {languageName(code, locale)}
                </Text>
                <Text
                  className="text-sm"
                  style={{ color: code === value ? colors.data : colors.subtle }}
                >
                  {code}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
          <Button label={t('common.close')} variant="ghost" onPress={() => setOpen(false)} />
        </View>
      </Sheet>
    </View>
  );
}
