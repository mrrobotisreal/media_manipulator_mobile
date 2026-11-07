import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Chips } from '@/ui/components/Chips';
import { Text } from '@/ui/components/Text';
import { useListVoicesQuery } from '@/api/endpoints/voices';
import type { VoicePreset } from '@/api/schemas/voices';

export interface VoiceTarget {
  voiceId?: string;
  preset?: string;
}

/** The target voice: the caller's saved voices, then the server's preset voices (web `voice-picker`). */
export function VoicePicker({
  value,
  onChange,
  presets,
  allowSaved = true,
}: {
  value: VoiceTarget;
  onChange: (next: VoiceTarget) => void;
  presets: readonly VoicePreset[];
  allowSaved?: boolean;
}) {
  const { t } = useTranslation();
  const list = useListVoicesQuery(undefined, { skip: !allowSaved });
  const saved = allowSaved ? (list.data?.voices ?? []) : [];
  const none = saved.length === 0 && presets.length === 0;
  return (
    <View className="gap-3" testID="voice-picker">
      <Text className="text-sm text-muted-fg">{t('interface:voiceTools.picker.label')}</Text>
      {saved.length > 0 ? (
        <View className="gap-2">
          <Text className="text-xs text-subtle">{t('interface:voiceTools.picker.saved')}</Text>
          <Chips
            testIDPrefix="saved"
            value={value.voiceId ?? null}
            onChange={(id) => onChange({ voiceId: id })}
            options={saved.map((v) => ({ value: v.id, label: v.name }))}
          />
        </View>
      ) : null}
      {presets.length > 0 ? (
        <View className="gap-2">
          <Text className="text-xs text-subtle">{t('interface:voiceTools.picker.presets')}</Text>
          <Chips
            testIDPrefix="preset"
            value={value.preset ?? null}
            onChange={(id) => onChange({ preset: id })}
            options={presets.map((p) => ({ value: p.id, label: p.name || p.id }))}
          />
        </View>
      ) : null}
      {none ? (
        <Text className="text-sm text-subtle">{t('interface:voiceTools.picker.none')}</Text>
      ) : null}
    </View>
  );
}

/** The languages a target speaks: a preset's own list when it has one, else every capabilities language. */
export function languagesFor(
  target: VoiceTarget,
  presets: readonly VoicePreset[],
  all: readonly string[],
): readonly string[] {
  if (target.preset) {
    const p = presets.find((x) => x.id === target.preset);
    if (p?.languages && p.languages.length > 0) return p.languages;
  }
  return all;
}
