import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Text } from '@/ui/components/Text';
import type { ToolFormProps, ToolOptions } from '../types';

function summarize(value: ToolOptions): string {
  return Object.entries(value)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join(' · ');
}

/** Read-only "uses the default settings" summary. MA17-MA21 replace it per tool. */
export function DefaultsForm({ value }: ToolFormProps) {
  const { t } = useTranslation();
  return (
    <View className="gap-1 rounded-lg border border-edge bg-surface-1 p-3">
      <Text className="font-semibold">{t('tool.defaultsForm.title')}</Text>
      <Text className="text-sm text-muted-fg">{t('tool.defaultsForm.body')}</Text>
      <Text className="font-mono text-xs text-subtle" accessibilityLabel="defaults">
        {summarize(value)}
      </Text>
    </View>
  );
}
