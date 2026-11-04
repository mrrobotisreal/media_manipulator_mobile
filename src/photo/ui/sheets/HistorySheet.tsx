/**
 * History (ticket MA51 decision 9; web `panels/history-panel.tsx`): the undo stack as a list of
 * named steps (tap to jump there, redoable steps stay listed), session snapshots (bookmark the
 * current version, jump back to one, delete), and "Clear history". Labels resolve through
 * `history.ts` (web keys `interface:photo.history.labels.*`, layer type names, preset names).
 */
import { useSyncExternalStore, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import { Button } from '@/ui/components/Button';
import { Text } from '@/ui/components/Text';
import { TextField } from '@/ui/components/TextField';
import { historySteps, resolveLabel, stepsTo } from '../../history';
import { mutate, photoActions } from '../../photoStore';
import { useEditor, useEditorTools, usePhotoSelector } from '../EditorContext';

// i18n-keys: photo.history.exportSettings, photo.history.source
export function useHistoryLabel() {
  const { t } = useTranslation();
  return (label: string) => {
    const r = resolveLabel(label);
    if (!r) return label;
    if ('presetBuiltin' in r)
      return t('interface:photo.history.labels.preset', {
        name: t(`interface:photo.presets.name.${r.presetBuiltin}`),
      });
    if ('presetUser' in r)
      return t('interface:photo.history.labels.preset', { name: r.presetUser });
    return t(r.key, r.vars);
  };
}

export function HistorySheet() {
  const { t } = useTranslation();
  const { store } = useEditor();
  const x = useEditorTools();
  const past = usePhotoSelector((s) => s.past);
  const future = usePhotoSelector((s) => s.future);
  const label = useHistoryLabel();
  const snaps = useSyncExternalStore(x.snapshots.subscribe, x.snapshots.get);
  const [name, setName] = useState('');
  const steps = historySteps(past, future);
  const jump = (target: number) =>
    store.dispatch(photoActions.jumped(stepsTo(store.getState().past.length, target)));

  return (
    <View className="gap-4" testID="photo-history-sheet">
      <View className="gap-1">
        <Pressable
          testID="photo-history-0"
          accessibilityRole="button"
          onPress={() => jump(0)}
          className={`rounded-md px-3 py-2 ${past.length === 0 ? 'bg-surface-3' : ''}`}
        >
          <Text className={past.length === 0 ? 'font-semibold' : ''}>
            {t('interface:photo.history.original')}
          </Text>
        </Pressable>
        {steps.length === 0 ? (
          <Text className="text-sm text-muted-fg">{t('interface:photo.history.empty')}</Text>
        ) : null}
        {steps.map((s) => (
          <Pressable
            key={s.index}
            testID={`photo-history-${s.index}`}
            accessibilityRole="button"
            accessibilityState={{ selected: s.current }}
            onPress={() => jump(s.index)}
            className={`rounded-md px-3 py-2 ${s.current ? 'bg-surface-3' : ''}`}
          >
            <Text className={s.current ? 'font-semibold' : s.applied ? '' : 'text-subtle'}>
              {label(s.label)}
            </Text>
          </Pressable>
        ))}
        <Button
          testID="photo-history-clear"
          variant="secondary"
          label={t('interface:photo.history.clear')}
          disabled={steps.length === 0}
          onPress={() => store.dispatch(photoActions.historyCleared())}
        />
      </View>

      <View className="gap-2">
        <Text className="font-semibold">{t('interface:photo.history.snapshots')}</Text>
        <Text className="text-sm text-muted-fg">
          {snaps.length === 0
            ? t('interface:photo.history.snapshotsEmpty')
            : t('interface:photo.history.sessionNote')}
        </Text>
        {snaps.map((s) => (
          <View key={s.id} className="flex-row items-center gap-2">
            <Pressable
              testID={`photo-snapshot-${s.id}`}
              accessibilityRole="button"
              className="flex-1 rounded-md px-3 py-2"
              onPress={() => mutate(store, 'snapshot', () => s.doc)}
            >
              <Text>{s.name}</Text>
            </Pressable>
            <Button
              variant="secondary"
              label={t('interface:photo.history.snapshotDelete')}
              onPress={() => x.snapshots.remove(s.id)}
            />
          </View>
        ))}
        <TextField
          testID="photo-snapshot-name"
          label={t('interface:photo.history.snapshotName')}
          value={name}
          onChangeText={setName}
          maxLength={60}
        />
        <Button
          testID="photo-snapshot-save"
          variant="secondary"
          label={t('interface:photo.history.snapshotSave')}
          onPress={() => {
            const d = store.getState().doc;
            if (!d) return;
            x.snapshots.add(
              name.trim() || t('interface:photo.history.snapshotDefault', { n: snaps.length + 1 }),
              d,
            );
            setName('');
          }}
        />
      </View>
    </View>
  );
}
