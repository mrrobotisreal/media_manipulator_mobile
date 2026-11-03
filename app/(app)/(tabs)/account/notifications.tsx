import { Linking, ScrollView } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Card, ScreenHeader } from '@/account/ui';
import { useGetSettingsQuery, usePatchSettingsMutation } from '@/api/endpoints/accountSettings';
import type { SettingsPatch } from '@/api/schemas/accountSettings';
import { askForPush } from '@/push/promptFlow';
import { usePushPermission } from '@/push/usePushPermission';
import { useAppDispatch } from '@/state/hooks';
import { Button, Screen, Text } from '@/ui/components';
import { ToggleRow } from '@/ui/components/ToggleRow';
import { showNotice } from '@/ui/notice';

export default function NotificationsScreen() {
  const { t } = useTranslation();
  const settings = useGetSettingsQuery();
  const [patch] = usePatchSettingsMutation();
  const s = settings.data;
  const dispatch = useAppDispatch();
  const permission = usePushPermission();
  const osOff = permission.state === 'denied';
  const needsAsk = permission.state === 'undetermined';
  const turnOnPush = async (v: boolean) => {
    // Undetermined: the same pre-prompt as the long-job one, surface 'settings'; the server flag follows the OS answer.
    if (v && needsAsk) {
      const granted = await askForPush(dispatch, 'settings');
      permission.refresh();
      if (!granted) return;
    }
    await save({ pushJobFinished: v });
  };
  const save = async (body: SettingsPatch) => {
    try {
      await patch(body).unwrap();
    } catch {
      showNotice(t('account.notifications.saveFailed'), 'error');
    }
  };
  return (
    <Screen edges="none">
      <ScreenHeader title={t('account.notifications.title')} />
      <ScrollView contentContainerClassName="gap-3 px-4 pb-8">
        {!s ? (
          <Text className="text-muted-fg">
            {settings.isError ? t('account.notifications.loadFailed') : t('common.loading')}
          </Text>
        ) : (
          <>
            <Card>
              <Text className="font-semibold">{t('account.notifications.emailTitle')}</Text>
              <ToggleRow
                label={t('account.notifications.emailAiJob')}
                value={s.emailAiJobFinished}
                onChange={(v) => void save({ emailAiJobFinished: v })}
              />
              <ToggleRow
                label={t('account.notifications.emailExpiry')}
                value={s.emailExpiryDigest}
                onChange={(v) => void save({ emailExpiryDigest: v })}
              />
              <Text className="text-xs text-subtle">{t('account.notifications.emailAlways')}</Text>
            </Card>
            {/* Only when the API sends the field (MA23 deployed); MA24 adds the OS-permission state here. */}
            {s.pushJobFinished !== undefined ? (
              <Card testID="push-card">
                <Text className="font-semibold">{t('account.notifications.pushTitle')}</Text>
                <ToggleRow
                  label={t('account.notifications.pushJobFinished')}
                  value={s.pushJobFinished && !osOff}
                  disabled={osOff}
                  onChange={(v) => void turnOnPush(v)}
                />
                {osOff ? (
                  <>
                    <Text className="text-sm text-subtle" testID="push-os-denied">
                      {t('push.settings.denied')}
                    </Text>
                    <Button
                      label={t('push.settings.openSettings')}
                      variant="secondary"
                      onPress={() => void Linking.openSettings()}
                    />
                  </>
                ) : null}
              </Card>
            ) : null}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
