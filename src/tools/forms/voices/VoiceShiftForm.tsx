import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { useAccountLimitsFull } from '@/quota/useAccountLimitsFull';
import { Chips } from '@/ui/components/Chips';
import { Segmented } from '@/ui/components/Segmented';
import { Slider } from '@/ui/components/Slider';
import { Text } from '@/ui/components/Text';
import { VOICE_SHIFT_PRESETS, VOICE_SHIFT_MAX_SEMITONES } from '../../voices/shift';
import { applyShiftPreset, type ShiftForm } from '../../options/voices';
import type { ToolFormProps } from '../../types';
import { RecorderPanel } from '@/voices/ui/RecorderPanel';
import { VoiceGate } from '@/voices/ui/VoiceGate';
import { useVoicesCapabilities } from '@/voices/useVoicesCapabilities';

const FALLBACK_MAX_SECONDS = 600;

/**
 * voice-shift (ticket MA34 decision 8): pitch -12..+12 semitones, formant Preserved / Shifted, or a preset
 * chip (the server's `capabilities.shiftPresets`, else the mirrored table). The recording comes from the
 * microphone here or from the file area above; the shifter needs neither the voice engine nor a GPU.
 */
export function VoiceShiftForm({ value, onChange, onFiles }: ToolFormProps<ShiftForm>) {
  const { t } = useTranslation();
  const limits = useAccountLimitsFull();
  const { caps } = useVoicesCapabilities();
  const table = caps && caps.shiftPresets.length > 0 ? caps.shiftPresets : VOICE_SHIFT_PRESETS;
  const maxSeconds =
    limits && limits.maxVideoSeconds > 0 ? limits.maxVideoSeconds : FALLBACK_MAX_SECONDS;
  return (
    <VoiceGate capability="voiceShift">
      <RecorderPanel
        maxSeconds={maxSeconds}
        hint={t('interface:voiceTools.recorder.inputHint')}
        onTake={(f) => onFiles?.([f])}
        onDiscard={() => onFiles?.([])}
      />
      <View className="gap-2">
        <Text className="text-sm text-muted-fg">
          {t('interface:voiceTools.shifter.presetsLabel')}
        </Text>
        <Chips
          testIDPrefix="shift-preset"
          value={value.preset ?? null}
          onChange={(id) => onChange(applyShiftPreset(value, id, table))}
          options={table.map((p) => ({
            value: p.id,
            label: t(`interface:voiceTools.shifter.presets.${p.id}`, { defaultValue: p.id }),
          }))}
        />
      </View>
      <Slider
        testID="shift-semitones"
        label={t('interface:voiceTools.shifter.semitonesLabel')}
        value={value.semitones}
        min={-VOICE_SHIFT_MAX_SEMITONES}
        max={VOICE_SHIFT_MAX_SEMITONES}
        step={1}
        format={(v) =>
          t('interface:voiceTools.shifter.semitonesValue', { value: v > 0 ? `+${v}` : `${v}` })
        }
        onChange={(semitones) => onChange({ ...value, semitones, preset: undefined })}
      />
      <View className="gap-2">
        <Text className="text-sm text-muted-fg">
          {t('interface:voiceTools.shifter.formantLabel')}
        </Text>
        <Segmented
          options={[
            { value: 'preserved', label: t('interface:voiceTools.shifter.formants.preserved') },
            { value: 'shifted', label: t('interface:voiceTools.shifter.formants.shifted') },
          ]}
          value={value.formant}
          onChange={(formant) => onChange({ ...value, formant, preset: undefined })}
        />
      </View>
      <Text className="text-sm text-subtle">{t('interface:voiceTools.changer.shiftHint')}</Text>
    </VoiceGate>
  );
}
