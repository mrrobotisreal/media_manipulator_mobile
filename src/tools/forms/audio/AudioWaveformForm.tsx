import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { useAccountLimitsFull } from '@/quota/useAccountLimitsFull';
import { useFactText } from '@/quota/useTierFacts';
import { Text } from '@/ui/components/Text';
import { TextField } from '@/ui/components/TextField';
import { Field, MoreSection, SwitchRow } from '../../components/OptionControls';
import { Chips } from '@/ui/components/Chips';
import { Stepper } from '@/ui/components/Stepper';
import { Swatches } from '@/ui/components/Swatches';
import {
  WAVEFORM_DIM,
  WAVEFORM_DRAWS,
  WAVEFORM_MODES,
  WAVEFORM_RATE,
  WAVEFORM_SCALES,
  WAVEFORM_SIZES,
  WAVEFORM_SWATCHES,
  overHeightLimit,
  type AudioWaveformForm as Form,
} from '../../options/audio';
import type { ToolFormProps } from '../../types';
import { useSetOption } from '../../useSetOption';

const MEDIUM = WAVEFORM_SIZES.filter((s) => s.qualifier === 'medium');

// i18n-keys: interface:audioWaveformPanel.output, interface:audioWaveformPanel.renderMode, interface:audioWaveformPanel.primaryColor, interface:audioWaveformPanel.secondaryColor, interface:audioWaveformPanel.splitChannels, interface:audioWaveformPanel.includeAudio, interface:audioWaveformPanel.videoFormat, interface:audioWaveformPanel.imageFormat, interface:audioWaveformPanel.aspectRatioSize, interface:audioWaveformPanel.useCustomSize, interface:audioWaveformPanel.widthPlaceholder, interface:audioWaveformPanel.heightPlaceholder, interface:audioWaveformPanel.frameRate, interface:audioWaveformPanel.fpsOption, interface:audioWaveformPanel.scale, interface:audioWaveformPanel.draw, interface:audioWaveformPanel.presets.10x1, interface:audioWaveformPanel.presets.8x1, interface:audioWaveformPanel.presets.6x1, interface:audioWaveformPanel.presets.16x9, interface:audioWaveformPanel.presets.1x1, interface:audioWaveformPanel.modes.point.label, interface:audioWaveformPanel.modes.line.label, interface:audioWaveformPanel.modes.p2p.label, interface:audioWaveformPanel.modes.cline.label, tools.audio.more, tools.audio.waveform.output.video, tools.audio.waveform.output.image, tools.audio.waveform.output.both, tools.audio.waveform.size, tools.audio.waveform.planLimit, tools.audio.waveform.colors, tools.audio.waveform.swatch
export function AudioWaveformForm({ value, onChange }: ToolFormProps<Form>) {
  const { t } = useTranslation();
  const set = useSetOption(value, onChange);
  const limits = useAccountLimitsFull();
  const max = limits?.maxOutputHeight;
  const fact = useFactText('maxOutputHeight');
  const anyDisabled = WAVEFORM_SIZES.some((s) => overHeightLimit(s.height, max));
  const customHeight = Number(value.customHeight);
  const customOver = value.sizeId === 'custom' && overHeightLimit(customHeight, max);
  const pw = 'interface:audioWaveformPanel';

  return (
    <View className="gap-5">
      <Field label={t(`${pw}.output`)}>
        <Chips
          testIDPrefix="output"
          value={value.output}
          onChange={(v) => set('output', v, 'waveform.output')}
          options={(['video', 'image', 'both'] as const).map((o) => ({
            value: o,
            label: t(`tools.audio.waveform.output.${o}`),
          }))}
        />
      </Field>
      <Field label={t('tools.audio.waveform.size')}>
        <Chips
          testIDPrefix="size"
          value={value.sizeId}
          onChange={(v) => set('sizeId', v, 'waveform.size')}
          options={MEDIUM.map((s) => ({
            value: s.id,
            label: `${t(`${pw}.presets.${s.ratio}`).split(' ')[0]} ${s.width}×${s.height}`,
            disabled: overHeightLimit(s.height, max),
          }))}
        />
        {anyDisabled || customOver ? (
          <View className="gap-1" testID="height-limit-hint">
            <Text className="text-sm text-muted-fg">
              {t('tools.audio.waveform.planLimit', { limit: max })}
            </Text>
            {fact ? <Text className="text-sm text-muted-fg">{fact}</Text> : null}
          </View>
        ) : null}
      </Field>
      <Field label={t(`${pw}.renderMode`)}>
        <Chips
          testIDPrefix="mode"
          value={value.mode}
          onChange={(v) => set('mode', v, 'waveform.mode')}
          options={WAVEFORM_MODES.map((m) => ({ value: m, label: t(`${pw}.modes.${m}.label`) }))}
        />
      </Field>
      <Field label={t(`${pw}.primaryColor`)}>
        <Swatches
          colors={WAVEFORM_SWATCHES}
          value={value.colorPrimary}
          onChange={(v) => set('colorPrimary', v, 'waveform.colorPrimary')}
        />
      </Field>
      <Field label={t(`${pw}.secondaryColor`)}>
        <Swatches
          colors={WAVEFORM_SWATCHES}
          value={value.colorSecondary}
          onChange={(v) => set('colorSecondary', v, 'waveform.colorSecondary')}
        />
      </Field>
      <SwitchRow
        testID="split-channels"
        label={t(`${pw}.splitChannels`)}
        value={value.splitChannels}
        onChange={(v) => set('splitChannels', v, 'waveform.splitChannels')}
      />
      {value.output !== 'image' ? (
        <SwitchRow
          testID="include-audio"
          label={t(`${pw}.includeAudio`)}
          value={value.includeAudio}
          onChange={(v) => set('includeAudio', v, 'waveform.includeAudio')}
        />
      ) : null}
      {value.output !== 'image' ? (
        <Field label={t(`${pw}.videoFormat`)}>
          <Chips
            testIDPrefix="videoformat"
            value={value.videoFormat}
            onChange={(v) => set('videoFormat', v, 'waveform.videoFormat')}
            options={[
              { value: 'mp4', label: 'MP4' },
              { value: 'webm', label: 'WebM' },
            ]}
          />
        </Field>
      ) : null}
      {value.output !== 'video' ? (
        <Field label={t(`${pw}.imageFormat`)}>
          <Chips
            testIDPrefix="imageformat"
            value={value.imageFormat}
            onChange={(v) => set('imageFormat', v, 'waveform.imageFormat')}
            options={[
              { value: 'png', label: 'PNG' },
              { value: 'webp', label: 'WebP' },
            ]}
          />
        </Field>
      ) : null}
      <MoreSection label={t('tools.audio.more')}>
        <Field label={t(`${pw}.aspectRatioSize`)}>
          <Chips
            testIDPrefix="size-other"
            value={value.sizeId}
            onChange={(v) => set('sizeId', v, 'waveform.size')}
            options={[
              ...WAVEFORM_SIZES.filter((s) => s.qualifier !== 'medium').map((s) => ({
                value: s.id,
                label: `${t(`${pw}.presets.${s.ratio}`).split(' ')[0]} ${s.width}×${s.height}`,
                disabled: overHeightLimit(s.height, max),
              })),
              { value: 'custom', label: t(`${pw}.useCustomSize`) },
            ]}
          />
          {value.sizeId === 'custom' ? (
            <View className="flex-row gap-3">
              <View className="flex-1">
                <TextField
                  testID="custom-width"
                  label={t(`${pw}.widthPlaceholder`)}
                  keyboardType="number-pad"
                  value={value.customWidth}
                  onChangeText={(v) => set('customWidth', v.replace(/\D/g, ''), 'waveform.width')}
                />
              </View>
              <View className="flex-1">
                <TextField
                  testID="custom-height"
                  label={t(`${pw}.heightPlaceholder`)}
                  keyboardType="number-pad"
                  value={value.customHeight}
                  onChangeText={(v) => set('customHeight', v.replace(/\D/g, ''), 'waveform.height')}
                  helper={`${WAVEFORM_DIM.min}–${WAVEFORM_DIM.max}`}
                />
              </View>
            </View>
          ) : null}
        </Field>
        <Stepper
          label={t(`${pw}.frameRate`)}
          value={value.rate}
          min={WAVEFORM_RATE.min}
          max={WAVEFORM_RATE.max}
          step={1}
          format={() => t(`${pw}.fpsOption`, { fps: value.rate })}
          onChange={(v) => set('rate', v, 'waveform.rate')}
        />
        <Field label={t(`${pw}.scale`)}>
          <Chips
            testIDPrefix="scale"
            value={value.scale}
            onChange={(v) => set('scale', v, 'waveform.scale')}
            options={WAVEFORM_SCALES.map((s) => ({ value: s, label: s }))}
          />
        </Field>
        <Field label={t(`${pw}.draw`)}>
          <Chips
            testIDPrefix="draw"
            value={value.draw}
            onChange={(v) => set('draw', v, 'waveform.draw')}
            options={WAVEFORM_DRAWS.map((d) => ({ value: d, label: d }))}
          />
        </Field>
      </MoreSection>
    </View>
  );
}
