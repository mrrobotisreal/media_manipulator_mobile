import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import {
  editFormValid,
  prefillFromDocument,
  type EditMetadataForm as Form,
  type LocationMode,
} from '../../options/metadata';
import { useInspect } from '@/metadata/useInspect';
import { MultiChips } from '@/ui/components/Chips';
import { Segmented } from '@/ui/components/Segmented';
import { Stepper } from '@/ui/components/Stepper';
import { Text } from '@/ui/components/Text';
import { TextField } from '@/ui/components/TextField';
import type { ToolFormProps } from '../../types';

type Flag = 'removeDirection' | 'removeTimestamp' | 'removeAltitude' | 'removeDestination';
const FLAGS: Flag[] = ['removeDirection', 'removeTimestamp', 'removeAltitude', 'removeDestination'];
const FIELDS = ['title', 'author', 'description', 'copyright', 'comment', 'keywords'] as const;

/**
 * `edit-metadata` (image only): custom = strip everything, then write only the fields given.
 * Text fields and the coordinates are prefilled from the inspected document.
 */
export function EditMetadataForm({ value, onChange, ctx }: ToolFormProps<Form>) {
  const { t } = useTranslation();
  const state = useInspect(ctx?.input);
  const prefilled = useRef<string | null>(null);
  const inputKey = ctx?.input?.id ?? ctx?.input?.uri ?? null;
  useEffect(() => {
    if (state.status !== 'ready' || !inputKey || prefilled.current === inputKey) return;
    prefilled.current = inputKey;
    onChange({ ...value, ...prefillFromDocument(state.document) });
    // Prefill once per file; later edits are the user's.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.status, inputKey]);

  const set = (patch: Partial<Form>) => onChange({ ...value, ...patch });
  const replacing = value.location === 'replace' || value.location === 'round';
  const location: { value: LocationMode; label: string }[] = [
    { value: 'keep', label: t('tools.metadata.edit.keep') },
    { value: 'remove', label: t('tools.metadata.edit.remove') },
    { value: 'replace', label: t('tools.metadata.edit.replace') },
    { value: 'round', label: t('tools.metadata.edit.round') },
  ];
  const active = FLAGS.filter((f) => value[f]);
  return (
    <View className="gap-4" testID="edit-metadata-form">
      <Text className="text-sm text-muted-fg">{t('tools.metadata.edit.customNote')}</Text>
      {FIELDS.map((f) => (
        <TextField
          key={f}
          label={t(`tools.metadata.edit.fields.${f}`)}
          value={value[f]}
          maxLength={1000}
          multiline={f === 'description' || f === 'comment'}
          onChangeText={(text) => set({ [f]: text })}
          testID={`edit-field-${f}`}
        />
      ))}
      <View className="gap-2">
        <Text className="font-semibold">{t('tools.metadata.edit.location')}</Text>
        <Segmented<LocationMode>
          options={location}
          value={value.location}
          onChange={(loc) => set({ location: loc })}
        />
        {replacing ? (
          <View className="gap-3">
            <TextField
              label={t('tools.metadata.edit.latitude')}
              value={value.latitude}
              keyboardType="decimal-pad"
              onChangeText={(text) => set({ latitude: text })}
              testID="edit-latitude"
            />
            <TextField
              label={t('tools.metadata.edit.longitude')}
              value={value.longitude}
              keyboardType="decimal-pad"
              onChangeText={(text) => set({ longitude: text })}
              testID="edit-longitude"
            />
            <TextField
              label={t('tools.metadata.edit.altitude')}
              value={value.altitude}
              keyboardType="decimal-pad"
              onChangeText={(text) => set({ altitude: text })}
              testID="edit-altitude"
            />
            {value.location === 'round' ? (
              <Stepper
                label={t('tools.metadata.edit.decimals')}
                value={value.precisionDecimals}
                min={0}
                max={8}
                onChange={(n) => set({ precisionDecimals: n })}
              />
            ) : null}
          </View>
        ) : null}
        {replacing && !editFormValid(value) ? (
          <Text accessibilityRole="alert" className="text-sm text-danger" testID="edit-invalid">
            {t('tools.metadata.edit.invalidLocation')}
          </Text>
        ) : null}
        <MultiChips<Flag>
          options={FLAGS.map((f) => ({ value: f, label: t(`tools.metadata.edit.${f}`) }))}
          value={active}
          onToggle={(f) => set({ [f]: !value[f] })}
        />
      </View>
    </View>
  );
}

// i18n-keys: tools.metadata.edit.fields.title, tools.metadata.edit.fields.author, tools.metadata.edit.fields.description, tools.metadata.edit.fields.copyright, tools.metadata.edit.fields.comment, tools.metadata.edit.fields.keywords, tools.metadata.edit.removeDirection, tools.metadata.edit.removeTimestamp, tools.metadata.edit.removeAltitude, tools.metadata.edit.removeDestination
