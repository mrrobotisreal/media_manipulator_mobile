import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { deleteAllFiles, deleteAnalyticsData, setAnalyticsOptOut } from '@/account/privacy';
import { realDeleteFilesDeps, realDsrDeps, realOptOutDeps } from '@/account/realDeps';
import { NavRow, Card, ScreenHeader } from '@/account/ui';
import { TypedConfirmSheet } from '@/account/TypedConfirmSheet';
import { runExport } from '@/account/exportFlow';
import { formatTimeLeft } from '@/lib/format';
import { useAppSelector } from '@/state/hooks';
import { Button, Screen, Sheet, Text } from '@/ui/components';
import { ToggleRow } from '@/ui/components/ToggleRow';
import { showNotice } from '@/ui/notice';

type Dialog = 'dsr' | 'files' | null;

export default function PrivacyScreen() {
  const { t } = useTranslation();
  const optedOut = useAppSelector((s) => s.settings.analyticsOptOut);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);

  const dsr = async () => {
    setBusy(true);
    const ok = await deleteAnalyticsData(realDsrDeps());
    setBusy(false);
    setDialog(null);
    showNotice(
      ok ? t('account.privacy.deleteAnalyticsDone') : t('account.privacy.deleteAnalyticsFailed'),
      ok ? 'info' : 'error',
    );
  };

  const files = async () => {
    setBusy(true);
    const outcome = await deleteAllFiles(realDeleteFilesDeps());
    setBusy(false);
    setDialog(null);
    showNotice(
      outcome === 'failed'
        ? t('account.privacy.deleteFilesFailed')
        : outcome === 'pending'
          ? t('account.privacy.deleteFilesPending')
          : t('account.privacy.deleteFilesDone'),
      outcome === 'failed' ? 'error' : 'info',
    );
  };

  const doExport = async () => {
    setExporting(true);
    const r = await runExport();
    setExporting(false);
    if (r.status === 'failed') showNotice(t('account.privacy.exportFailed'), 'error');
    else if (r.status === 'rate_limited')
      showNotice(
        t('account.privacy.exportRateLimited', {
          time: formatTimeLeft(Date.now() + r.retryAfterSeconds * 1000),
        }),
        'error',
      );
  };

  return (
    <Screen edges="none">
      <ScreenHeader title={t('account.privacy.title')} />
      <ScrollView contentContainerClassName="gap-3 px-4 pb-8">
        <Card>
          <Text className="font-semibold">{t('account.privacy.analyticsTitle')}</Text>
          <ToggleRow
            label={t('analytics.optOut.title')}
            hint={t('analytics.optOut.helper')}
            value={!optedOut}
            onChange={(share) => setAnalyticsOptOut(!share, realOptOutDeps())}
          />
          <View className="gap-2 border-t border-edge pt-3">
            <Text className="font-medium">{t('account.privacy.deleteAnalyticsTitle')}</Text>
            <Text className="text-sm text-muted-fg">
              {t('account.privacy.deleteAnalyticsBody')}
            </Text>
            <Button
              label={t('account.privacy.deleteAnalyticsCta')}
              variant="secondary"
              onPress={() => setDialog('dsr')}
            />
          </View>
        </Card>

        <Card>
          <Text className="font-semibold">{t('account.privacy.dataTitle')}</Text>
          <View className="gap-2">
            <Text className="font-medium">{t('account.privacy.exportTitle')}</Text>
            <Text className="text-sm text-muted-fg">{t('account.privacy.exportBody')}</Text>
            <Button
              label={exporting ? t('account.privacy.exporting') : t('account.privacy.exportCta')}
              variant="secondary"
              loading={exporting}
              onPress={() => void doExport()}
            />
          </View>
          <View className="gap-2 border-t border-edge pt-3">
            <Text className="font-medium">{t('account.privacy.deleteFilesTitle')}</Text>
            <Text className="text-sm text-muted-fg">{t('account.privacy.deleteFilesBody')}</Text>
            <Button
              label={t('account.privacy.deleteFilesCta')}
              variant="danger"
              onPress={() => setDialog('files')}
            />
          </View>
        </Card>

        <NavRow
          label={t('account.privacy.deleteAccountTitle')}
          danger
          href="/(app)/(tabs)/account/delete-account"
          testID="delete-account-row"
        />
      </ScrollView>

      <Sheet visible={dialog === 'dsr'} onClose={() => !busy && setDialog(null)}>
        <View className="gap-3">
          <Text className="text-lg font-semibold">
            {t('account.privacy.deleteAnalyticsDialogTitle')}
          </Text>
          <Text className="text-muted-fg">{t('account.privacy.deleteAnalyticsDialogBody')}</Text>
          <Button
            label={t('account.privacy.deleteAnalyticsCta')}
            variant="danger"
            loading={busy}
            onPress={() => void dsr()}
          />
          <Button
            label={t('common.cancel')}
            variant="ghost"
            disabled={busy}
            onPress={() => setDialog(null)}
          />
        </View>
      </Sheet>
      <TypedConfirmSheet
        visible={dialog === 'files'}
        title={t('account.privacy.deleteFilesDialogTitle')}
        body={t('account.privacy.deleteFilesDialogBody')}
        phrase="DELETE"
        confirmLabel={t('account.privacy.deleteFilesCta')}
        busy={busy}
        onConfirm={() => void files()}
        onClose={() => setDialog(null)}
      />
    </Screen>
  );
}
