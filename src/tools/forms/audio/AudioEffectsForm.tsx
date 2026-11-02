import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { formatNumber } from '@/lib/format';
import { Text } from '@/ui/components/Text';
import { Field } from '@/ui/components/Field';
import { Chips, MultiChips } from '@/ui/components/Chips';
import { Stepper } from '@/ui/components/Stepper';
import {
  AUDIO_EFFECTS,
  AUDIO_FORMATS,
  EQ_PRESETS,
  PITCH_RANGE,
  REVERB_TYPES,
  SPEED_RANGE,
  VOLUME_RANGE,
  sameAsOriginalFormat,
  type AudioEffect,
  type AudioEffectsForm as Form,
  type FormatChoice,
} from '../../options/audio';
import type { ToolFormProps } from '../../types';
import { useSetOption } from '../../useSetOption';
import { formatChoiceOptions } from './formatChoice';

// i18n-keys: tools.audio.effects.pick, tools.audio.effects.speed, tools.audio.effects.volume, tools.audio.effects.pitch, tools.audio.effects.normalize, tools.audio.effects.eq, tools.audio.effects.reverb, tools.audio.effects.semitones, tools.audio.effects.eqPreset.bass-boost, tools.audio.effects.eqPreset.treble-boost, tools.audio.effects.eqPreset.vocal, tools.audio.effects.eqPreset.classical, tools.audio.effects.eqPreset.rock, tools.audio.effects.eqPreset.jazz, tools.audio.effects.reverbType.room, tools.audio.effects.reverbType.hall, tools.audio.effects.reverbType.plate, tools.audio.effects.reverbType.spring, tools.audio.format, tools.audio.sameAsOriginal
export function AudioEffectsForm({ value, onChange, ctx }: ToolFormProps<Form>) {
  const { t } = useTranslation();
  const set = useSetOption(value, onChange);
  const has = (e: AudioEffect) => value.effects.includes(e);
  const toggle = (e: AudioEffect) => {
    const effects = has(e)
      ? value.effects.filter((x) => x !== e)
      : AUDIO_EFFECTS.filter((x) => x === e || value.effects.includes(x));
    onChange({ ...value, effects });
  };
  const x = (n: number) => `${formatNumber(n, undefined, { maximumFractionDigits: 2 })}×`;
  return (
    <View className="gap-5">
      <Field label={t('tools.audio.effects.pick')}>
        <MultiChips
          testIDPrefix="effect"
          value={value.effects}
          onToggle={toggle}
          options={AUDIO_EFFECTS.map((e) => ({ value: e, label: t(`tools.audio.effects.${e}`) }))}
        />
        {value.effects.length === 0 ? (
          <Text className="text-sm text-danger" testID="effects-pick-hint">
            {t('tools.audio.effects.pick')}
          </Text>
        ) : null}
      </Field>
      {has('speed') ? (
        <Stepper
          label={t('tools.audio.effects.speed')}
          value={value.speed}
          {...SPEED_RANGE}
          format={() => x(value.speed)}
          onChange={(v) => set('speed', v, 'effects.speed')}
        />
      ) : null}
      {has('volume') ? (
        <Stepper
          label={t('tools.audio.effects.volume')}
          value={value.volume}
          {...VOLUME_RANGE}
          format={() => x(value.volume)}
          onChange={(v) => set('volume', v, 'effects.volume')}
        />
      ) : null}
      {has('pitch') ? (
        <Stepper
          label={t('tools.audio.effects.pitch')}
          value={value.pitch}
          {...PITCH_RANGE}
          format={() =>
            t('tools.audio.effects.semitones', {
              count: Math.abs(value.pitch),
              value: formatNumber(value.pitch, undefined, { signDisplay: 'exceptZero' }),
            })
          }
          onChange={(v) => set('pitch', v, 'effects.pitch')}
        />
      ) : null}
      {has('eq') ? (
        <Field label={t('tools.audio.effects.eq')}>
          <Chips
            testIDPrefix="eq"
            value={value.eq}
            onChange={(v) => set('eq', v, 'effects.eq')}
            options={EQ_PRESETS.map((p) => ({
              value: p,
              label: t(`tools.audio.effects.eqPreset.${p}`),
            }))}
          />
        </Field>
      ) : null}
      {has('reverb') ? (
        <Field label={t('tools.audio.effects.reverb')}>
          <Chips
            testIDPrefix="reverb"
            value={value.reverb}
            onChange={(v) => set('reverb', v, 'effects.reverb')}
            options={REVERB_TYPES.map((r) => ({
              value: r,
              label: t(`tools.audio.effects.reverbType.${r}`),
            }))}
          />
        </Field>
      ) : null}
      <Field label={t('tools.audio.format')}>
        <Chips
          testIDPrefix="format"
          value={value.format}
          onChange={(v: FormatChoice) => set('format', v)}
          options={formatChoiceOptions(
            t,
            ctx?.input?.extension,
            AUDIO_FORMATS,
            sameAsOriginalFormat,
          )}
        />
      </Field>
    </View>
  );
}
