import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, View } from 'react-native';
import type { VoiceCapability } from '@/tools/types';
import { colors } from '@/ui/tokens';
import { Text } from '@/ui/components/Text';
import { isVoiceCapabilityMet } from '../gating';
import { useVoicesCapabilities } from '../useVoicesCapabilities';

/**
 * Wraps a Voices form: the Tools tab already hides a row the server does not offer, but a deep link (Medi,
 * a recent) can still open one, so the form says why it cannot run (the web's `unavailable` card) instead of
 * showing controls that would 503. While the server is cold (`warm:false`) it shows the web's warming-up note.
 */
export function VoiceGate({
  capability,
  children,
}: {
  capability: VoiceCapability;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const { caps, isLoading } = useVoicesCapabilities();
  if (isLoading) {
    return (
      <View className="flex-row items-center gap-2" testID="voice-gate-loading">
        <ActivityIndicator color={colors.data} />
        <Text className="text-muted-fg">{t('interface:voiceTools.loading')}</Text>
      </View>
    );
  }
  if (!isVoiceCapabilityMet(capability, caps)) {
    const shiftWorks = capability !== 'voiceShift';
    return (
      <View
        className="gap-2 rounded-lg border border-edge bg-surface-1 p-3"
        testID="voice-unavailable"
      >
        <Text className="font-semibold">{t('interface:voiceTools.unavailable.title')}</Text>
        <Text className="text-muted-fg">{t('interface:voiceTools.unavailable.body')}</Text>
        {shiftWorks ? (
          <Text className="text-sm text-subtle">
            {t('interface:voiceTools.unavailable.shiftStillWorks')}
          </Text>
        ) : null}
      </View>
    );
  }
  return (
    <View className="gap-4">
      {capability !== 'voiceShift' && caps && !caps.warm ? (
        <Text className="text-sm text-subtle" testID="voice-warming">
          {t('interface:voiceTools.warmingUp')}
        </Text>
      ) : null}
      {children}
    </View>
  );
}
