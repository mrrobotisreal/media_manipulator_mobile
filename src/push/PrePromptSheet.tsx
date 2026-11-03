import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Button, Sheet, Text } from '@/ui/components';
import { answerPrePrompt, usePrePromptSurface } from './prePromptStore';

/** The pre-prompt (decision 4): shown before the OS dialog; "Not now" starts the 30-day quiet window. */
export function PrePromptSheet() {
  const { t } = useTranslation();
  const surface = usePrePromptSurface();
  const path = `${t('tabs.account')} → ${t('account.notifications.title')}`;
  return (
    <Sheet visible={surface !== null} onClose={() => answerPrePrompt(false)}>
      <View className="gap-3" testID="push-preprompt">
        <Text accessibilityRole="header" className="text-lg font-semibold">
          {t('push.prePrompt.title')}
        </Text>
        <Text className="text-muted-fg">{t('push.prePrompt.body', { path })}</Text>
        <Button label={t('push.prePrompt.accept')} onPress={() => answerPrePrompt(true)} />
        <Button
          label={t('push.prePrompt.dismiss')}
          variant="ghost"
          onPress={() => answerPrePrompt(false)}
        />
      </View>
    </Sheet>
  );
}
