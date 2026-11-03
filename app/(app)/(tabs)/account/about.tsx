import * as Application from 'expo-application';
import * as Clipboard from 'expo-clipboard';
import * as Updates from 'expo-updates';
import { Linking, ScrollView, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { diagnosticsText } from '@/account/diagnostics';
import { Card, ScreenHeader } from '@/account/ui';
import { API_BASE_URL } from '@/api/config';
import { appVersionString } from '@/lib/userAgent';
import { Button, Num, Screen, Text } from '@/ui/components';
import { showNotice } from '@/ui/notice';

export const SUPPORT_EMAIL = 'support@media-manipulator.com';

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View className="min-h-[32px] flex-row items-center justify-between gap-3">
      <Text className="text-sm text-muted-fg">{label}</Text>
      <Num className="flex-1 text-end text-sm">{value}</Num>
    </View>
  );
}

export default function AboutScreen() {
  const { t } = useTranslation();
  const info = {
    version: appVersionString(),
    updateId: Updates.isEmbeddedLaunch ? null : (Updates.updateId ?? null),
    channel: Updates.channel ?? null,
    runtimeVersion: Updates.runtimeVersion ?? null,
    apiBaseUrl: API_BASE_URL,
    application: Application.applicationId ?? null,
  };
  const none = t('account.about.none');
  const copy = async () => {
    await Clipboard.setStringAsync(diagnosticsText(info));
    showNotice(t('account.about.copied'));
  };
  return (
    <Screen edges="none">
      <ScreenHeader title={t('account.about.title')} />
      <ScrollView contentContainerClassName="gap-3 px-4 pb-8">
        <Card>
          <Row label={t('account.about.version')} value={info.version} />
          <Row
            label={t('account.about.update')}
            value={info.updateId ?? t('account.about.updateEmbedded')}
          />
          <Row label={t('account.about.channel')} value={info.channel ?? none} />
          <Row label={t('account.about.runtime')} value={info.runtimeVersion ?? none} />
          <Row label={t('account.about.api')} value={new URL(info.apiBaseUrl).host} />
        </Card>
        <Button
          label={t('account.about.copyDiagnostics')}
          variant="secondary"
          onPress={() => void copy()}
        />
        <Button
          label={t('account.about.contact')}
          variant="secondary"
          onPress={() => void Linking.openURL(`mailto:${SUPPORT_EMAIL}`).catch(() => undefined)}
        />
      </ScrollView>
    </Screen>
  );
}
