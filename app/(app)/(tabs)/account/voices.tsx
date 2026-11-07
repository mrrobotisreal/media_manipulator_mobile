import { router, type Href } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Card, ScreenHeader } from '@/account/ui';
import {
  useDeleteVoiceMutation,
  useListVoicesQuery,
  useRenameVoiceMutation,
} from '@/api/endpoints/voices';
import { isMmError, type MmError } from '@/api/errors';
import type { SavedVoice } from '@/api/schemas/voices';
import { formatNumber } from '@/lib/format';
import { VOICE_NAME_MAX_CHARS } from '@/tools/voices/consent';
import { Button, Screen, Sheet, Text, TextField } from '@/ui/components';
import { Num } from '@/ui/components/Text';
import { showNotice } from '@/ui/notice';
import { voiceErrorText } from '@/voices/errors';
import { isFull } from '@/voices/myVoices';
import { SpeakPanel } from '@/voices/ui/SpeakPanel';
import { VoiceSummary } from '@/voices/ui/VoiceCard';
import { useVoicesCapabilities } from '@/voices/useVoicesCapabilities';

type Sheet_ =
  | { kind: 'rename'; voice: SavedVoice }
  | { kind: 'delete'; voice: SavedVoice }
  | { kind: 'speak'; voice: SavedVoice }
  | null;

/**
 * My voices (ticket MA34 decision 9), reached from Account and from the Voices tools: the saved voices with
 * their consent date, preview, Rename, Delete (confirm sheet) and "Speak with this voice"; `used / limit` in
 * mono numerals. Speech started here reports `source: 'account'`.
 */
export default function MyVoicesScreen() {
  const { t } = useTranslation();
  const list = useListVoicesQuery();
  const { caps } = useVoicesCapabilities();
  const [rename, renameState] = useRenameVoiceMutation();
  const [remove, removeState] = useDeleteVoiceMutation();
  const [sheet, setSheet] = useState<Sheet_>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState<MmError | null>(null);

  const data = list.data;
  const close = useCallback(() => {
    setSheet(null);
    setError(null);
  }, []);

  const doRename = async () => {
    if (sheet?.kind !== 'rename' || !name.trim()) return;
    setError(null);
    const r = await rename({ id: sheet.voice.id, name: name.trim() });
    if ('error' in r && r.error) {
      setError(isMmError(r.error) ? r.error : null);
      return;
    }
    close();
  };
  const doDelete = async () => {
    if (sheet?.kind !== 'delete') return;
    setError(null);
    const r = await remove(sheet.voice.id);
    if ('error' in r && r.error) {
      setError(isMmError(r.error) ? r.error : null);
      return;
    }
    showNotice(t('tools.voices.myVoices.deleted'));
    close();
  };

  return (
    <Screen>
      <ScreenHeader title={t('interface:voiceTools.myVoices.title')} />
      <ScrollView contentContainerClassName="gap-3 px-4 pb-8 pt-2">
        {data ? (
          <Num className="text-sm text-muted-fg" testID="voices-usage">
            {data.limit === -1
              ? t('interface:voiceTools.clone.usageUnlimited', { used: formatNumber(data.used) })
              : t('interface:voiceTools.clone.usage', {
                  used: formatNumber(data.used),
                  limit: formatNumber(data.limit),
                })}
          </Num>
        ) : null}
        {data && isFull(data.used, data.limit) && data.limit > 0 ? (
          <Text testID="voices-full" className="text-sm text-muted-fg">
            {t('tools.voices.limitReached', {
              used: formatNumber(data.used),
              limit: formatNumber(data.limit),
            })}
          </Text>
        ) : null}
        {list.isLoading ? <Text className="text-muted-fg">{t('common.loading')}</Text> : null}
        {list.isError ? (
          <View className="gap-2">
            <Text className="text-danger">{t('tools.voices.myVoices.loadFailed')}</Text>
            <Button
              variant="secondary"
              label={t('common.retry')}
              onPress={() => void list.refetch()}
            />
          </View>
        ) : null}
        {data && data.voices.length === 0 ? (
          <Text testID="voices-empty" className="text-muted-fg">
            {t('interface:voiceTools.myVoices.empty')}
          </Text>
        ) : null}
        {data?.voices.map((v) => (
          <Card key={v.id} testID={`voice-card-${v.id}`}>
            <VoiceSummary voice={v} />
            <View className="flex-row flex-wrap gap-2">
              {caps?.enabled && caps.limits.textMaxChars > 0 ? (
                <Button
                  testID={`voice-speak-${v.id}`}
                  label={t('tools.voices.myVoices.speakWith')}
                  onPress={() => setSheet({ kind: 'speak', voice: v })}
                />
              ) : null}
              <Button
                testID={`voice-rename-${v.id}`}
                variant="secondary"
                label={t('tools.voices.myVoices.rename')}
                onPress={() => {
                  setName(v.name);
                  setSheet({ kind: 'rename', voice: v });
                }}
              />
              <Button
                testID={`voice-delete-${v.id}`}
                variant="ghost"
                label={t('tools.voices.myVoices.delete')}
                onPress={() => setSheet({ kind: 'delete', voice: v })}
              />
            </View>
          </Card>
        ))}
        <Button
          variant="ghost"
          label={t('tools.voices.myVoices.openClone')}
          onPress={() => router.push('/(app)/tool/voices/voice-clone?from=other' as Href)}
        />
      </ScrollView>

      <Sheet visible={sheet?.kind === 'rename'} onClose={close}>
        <View className="gap-3">
          <Text className="text-lg font-semibold">{t('tools.voices.myVoices.rename')}</Text>
          <TextField
            testID="rename-input"
            label={t('interface:voiceTools.clone.nameLabel')}
            value={name}
            onChangeText={setName}
            maxLength={VOICE_NAME_MAX_CHARS}
            error={error ? voiceErrorText(t, error) : null}
          />
          <Button
            testID="rename-save"
            label={t('tools.voices.myVoices.save')}
            disabled={!name.trim()}
            loading={renameState.isLoading}
            onPress={() => void doRename()}
          />
          <Button label={t('common.cancel')} variant="ghost" onPress={close} />
        </View>
      </Sheet>

      <Sheet visible={sheet?.kind === 'delete'} onClose={close}>
        <View className="gap-3">
          <Text className="text-lg font-semibold">{t('tools.voices.myVoices.deleteTitle')}</Text>
          <Text testID="delete-body" className="text-muted-fg">
            {t('tools.voices.deleteConfirm')}
          </Text>
          {error ? <Text className="text-sm text-danger">{voiceErrorText(t, error)}</Text> : null}
          <Button
            testID="delete-confirm"
            variant="danger"
            label={t('tools.voices.myVoices.delete')}
            loading={removeState.isLoading}
            onPress={() => void doDelete()}
          />
          <Button label={t('common.cancel')} variant="ghost" onPress={close} />
        </View>
      </Sheet>

      <Sheet visible={sheet?.kind === 'speak'} onClose={close} fullHeight>
        {sheet?.kind === 'speak' && caps ? (
          <ScrollView contentContainerClassName="gap-3 p-4">
            <Text className="text-lg font-semibold">{sheet.voice.name}</Text>
            <SpeakPanel
              caps={caps}
              voice={{ id: sheet.voice.id, name: sheet.voice.name }}
              defaultLanguage={sheet.voice.languageHint}
              source="account"
              toolId="voice-clone"
            />
            <Button label={t('common.close')} variant="ghost" onPress={close} />
          </ScrollView>
        ) : null}
      </Sheet>
    </Screen>
  );
}
