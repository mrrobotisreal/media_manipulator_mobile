import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import { formatTimeLeft } from '@/lib/format';
import { QuotaMeter } from '@/ui/components/QuotaMeter';
import { Text } from '@/ui/components/Text';
import { PlanSheet } from './PlanSheet';
import { maybeWarn } from './quotaWarning';
import { useAllowance } from './useAllowance';

/** Tools-tab header (fills MA10's slot): both meters, "Resets in …", tap opens Plan & limits. */
export function QuotaHeader() {
  const { t } = useTranslation();
  const a = useAllowance();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    maybeWarn(a.ops);
    maybeWarn(a.ai_ops);
  }, [a.ops, a.ai_ops]);

  const unlimited = a.ops?.unlimited && a.ai_ops?.unlimited;
  const time = a.resetsAt ? formatTimeLeft(a.resetsAt, undefined, a.now) : '';
  return (
    <>
      <Pressable
        testID="quota-header-slot"
        accessibilityRole="button"
        accessibilityLabel={t('quota.planSheet.title')}
        onPress={() => setOpen(true)}
        className="mx-4 mt-3 gap-2 rounded-lg border border-edge bg-surface-1 px-3 py-2"
      >
        {unlimited ? (
          <Text className="text-sm text-muted-fg">{t('interface:quotaMeter.unlimited')}</Text>
        ) : (
          <View className="flex-row gap-4">
            <View className="flex-1">
              <QuotaMeter
                metric="ops"
                used={a.ops?.used ?? 0}
                limit={a.ops ? (a.ops.unlimited ? -1 : a.ops.limit) : 0}
                pending={!a.ops}
              />
            </View>
            <View className="flex-1">
              <QuotaMeter
                metric="ai_ops"
                used={a.ai_ops?.used ?? 0}
                limit={a.ai_ops ? (a.ai_ops.unlimited ? -1 : a.ai_ops.limit) : 0}
                pending={!a.ai_ops}
              />
            </View>
          </View>
        )}
        {time ? (
          <Text testID="quota-resets" className="text-xs text-muted-fg">
            {t('quota.resetsIn', { time })}
          </Text>
        ) : null}
      </Pressable>
      <PlanSheet visible={open} onClose={() => setOpen(false)} />
    </>
  );
}
