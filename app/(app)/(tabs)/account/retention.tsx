import { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Check } from 'lucide-react-native';
import {
  commitRetention,
  requestRetention,
  useBusy,
  type RetentionSaveDeps,
} from '@/account/useRetentionSave';
import {
  FALLBACK_LIMITS,
  parseCustomDays,
  presetForHours,
  previewTotal,
  RECOMMENDED_PRESET,
  RETENTION_PRESETS,
} from '@/account/retention';
import { Card, ScreenHeader } from '@/account/ui';
import {
  useGetSettingsQuery,
  useLazyPreviewRetentionQuery,
  usePatchSettingsMutation,
} from '@/api/endpoints/accountSettings';
import type { RetentionPreview } from '@/api/schemas/accountSettings';
import { formatBytes, formatRetention } from '@/lib/format';
import { Button, Screen, Segmented, Sheet, Text, TextField } from '@/ui/components';
import { ToggleRow } from '@/ui/components/ToggleRow';
import { showNotice } from '@/ui/notice';
import { colors } from '@/ui/tokens';

export default function RetentionScreen() {
  const { t } = useTranslation();
  const settings = useGetSettingsQuery();
  const [patch] = usePatchSettingsMutation();
  const [fetchPreview] = useLazyPreviewRetentionQuery();
  const { busy, run } = useBusy();
  const [custom, setCustom] = useState('');
  const [customError, setCustomError] = useState(false);
  const [pending, setPending] = useState<{ hours: number; preview: RetentionPreview } | null>(null);
  const s = settings.data;
  const limits = s?.limits ?? FALLBACK_LIMITS;
  const current = s?.retentionHours;
  const currentPreset = current !== undefined ? presetForHours(current) : null;

  const deps = useMemo<RetentionSaveDeps | null>(
    () =>
      current === undefined
        ? null
        : {
            current,
            preview: (hours) => fetchPreview(hours, false).unwrap(),
            patch: (body) => patch(body).unwrap(),
          },
    [current, fetchPreview, patch],
  );

  const window = (hours: number) => formatRetention(hours);
  const finish = (outcome: Awaited<ReturnType<typeof requestRetention>>, hours: number) => {
    if (outcome.status === 'saved')
      showNotice(t('account.retention.saved', { window: window(hours) }));
    else if (outcome.status === 'previewFailed')
      showNotice(t('account.retention.previewFailed'), 'error');
    else if (outcome.status === 'saveFailed')
      showNotice(t('account.retention.saveFailed'), 'error');
    else if (outcome.status === 'confirm') setPending({ hours, preview: outcome.preview });
  };
  const choose = async (hours: number) => {
    if (!deps || hours === current) return;
    finish(await run(() => requestRetention(hours, deps)), hours);
  };
  const confirm = async () => {
    if (!deps || !pending) return;
    const { hours } = pending;
    setPending(null);
    finish(await run(() => commitRetention(hours, deps)), hours);
  };
  const applyCustom = () => {
    const parsed = parseCustomDays(custom, limits);
    if (!parsed.ok) return setCustomError(true);
    setCustomError(false);
    void choose(parsed.hours);
  };
  const patchField = async (body: Parameters<typeof patch>[0]) => {
    try {
      await patch(body).unwrap();
    } catch {
      showNotice(t('account.retention.settingFailed'), 'error');
    }
  };

  const total = pending ? previewTotal(pending.preview) : 0;
  return (
    <Screen edges="none">
      <ScreenHeader title={t('account.retention.title')} />
      <ScrollView contentContainerClassName="gap-3 px-4 pb-8" keyboardShouldPersistTaps="handled">
        {!s ? (
          <Text className="text-muted-fg">
            {settings.isError ? t('account.retention.loadFailed') : t('common.loading')}
          </Text>
        ) : (
          <>
            <Card>
              <Text className="font-semibold">{t('account.retention.heading')}</Text>
              <Text className="text-sm text-muted-fg">{t('account.retention.body')}</Text>
              <Text className="text-sm" testID="retention-current">
                {t('account.retention.current', { window: window(s.retentionHours) })}
              </Text>
            </Card>
            <View
              accessibilityRole="radiogroup"
              className="overflow-hidden rounded-lg border border-edge bg-surface-1"
            >
              {RETENTION_PRESETS.filter(
                (p) => p.hours >= limits.minHours && p.hours <= limits.maxHours,
              ).map((p) => (
                <Pressable
                  key={p.id}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: currentPreset === p.id, disabled: busy }}
                  disabled={busy}
                  onPress={() => void choose(p.hours)}
                  className="min-h-[48px] flex-row items-center gap-3 border-b border-edge px-4 py-2"
                >
                  <Text className="flex-1">{t(`account.retention.presets.${p.id}`)}</Text>
                  {p.id === RECOMMENDED_PRESET ? (
                    <Text className="text-xs text-muted-fg">
                      {t('account.retention.recommended')}
                    </Text>
                  ) : null}
                  {currentPreset === p.id ? <Check size={20} color={colors.primary} /> : null}
                </Pressable>
              ))}
              <View className="gap-2 px-4 py-3">
                <View className="flex-row items-center gap-3">
                  <Text className="flex-1">{t('account.retention.custom')}</Text>
                  {current !== undefined && currentPreset === null ? (
                    <Check size={20} color={colors.primary} />
                  ) : null}
                </View>
                <TextField
                  label={t('account.retention.customLabel')}
                  value={custom}
                  onChangeText={(v) => {
                    setCustom(v);
                    setCustomError(false);
                  }}
                  keyboardType="number-pad"
                  error={customError ? t('account.retention.customInvalid') : null}
                />
                <Button
                  label={t('account.retention.customApply')}
                  variant="secondary"
                  disabled={busy || custom.trim() === ''}
                  onPress={applyCustom}
                />
              </View>
            </View>

            <Card>
              <Text className="font-semibold">{t('account.retention.metadataTitle')}</Text>
              <ToggleRow
                label={t('account.retention.metadataToggle')}
                hint={t('account.retention.metadataHint')}
                value={s.deleteMetadataReports}
                onChange={(v) => void patchField({ deleteMetadataReports: v })}
              />
            </Card>
            <Card>
              <Text className="font-semibold">{t('account.retention.visibilityTitle')}</Text>
              <Text className="text-sm text-muted-fg">
                {t('account.retention.visibilityLabel')}
              </Text>
              <Segmented
                options={[
                  { value: 'full', label: t('account.retention.visibilityFull') },
                  { value: 'names_only', label: t('account.retention.visibilityNamesOnly') },
                ]}
                value={s.historyVisibility}
                onChange={(v) => void patchField({ historyVisibility: v })}
              />
            </Card>
          </>
        )}
      </ScrollView>
      <Sheet visible={pending !== null} onClose={() => setPending(null)}>
        <View className="gap-3" testID="retention-confirm">
          <Text className="text-lg font-semibold">{t('account.retention.confirmTitle')}</Text>
          <Text className="text-muted-fg">
            {t('account.retention.confirmBody', {
              count: total,
              size: formatBytes(pending?.preview.wouldDelete.bytes ?? 0),
            })}
          </Text>
          <Button
            label={t('account.retention.confirmCta')}
            variant="danger"
            onPress={() => void confirm()}
          />
          <Button label={t('common.cancel')} variant="ghost" onPress={() => setPending(null)} />
        </View>
      </Sheet>
    </Screen>
  );
}
