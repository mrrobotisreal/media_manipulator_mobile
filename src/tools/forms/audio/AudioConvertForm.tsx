import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { ChipRow, Field, MoreSection } from '../../components/OptionControls';
import {
  AUDIO_FORMATS,
  BITRATES,
  CHANNELS,
  SAMPLE_RATES,
  hasBitrate,
  type AudioConvertForm as Form,
} from '../../options/audio';
import type { ToolFormProps } from '../../types';
import { useTrackOption } from '../../useTrackOption';

const FORMAT_LABEL: Record<string, string> = {
  mp3: 'MP3',
  wav: 'WAV',
  aac: 'AAC',
  ogg: 'OGG',
  flac: 'FLAC',
  alac: 'ALAC',
  opus: 'Opus',
};

// i18n-keys: tools.audio.format, tools.audio.bitrate, tools.audio.bitrateValue, tools.audio.sampleRate, tools.audio.channels, tools.audio.mono, tools.audio.stereo, tools.audio.more
export function AudioConvertForm({ value, onChange }: ToolFormProps<Form>) {
  const { t } = useTranslation();
  const set = useTrackOption(value, onChange);
  return (
    <View className="gap-5">
      <Field label={t('tools.audio.format')}>
        <ChipRow
          testIDPrefix="format"
          value={value.format}
          onChange={(v) => set('format', v)}
          options={AUDIO_FORMATS.map((f) => ({ value: f, label: FORMAT_LABEL[f]! }))}
        />
      </Field>
      {hasBitrate(value.format) ? (
        <Field label={t('tools.audio.bitrate')}>
          <ChipRow
            testIDPrefix="bitrate"
            value={value.bitrate}
            onChange={(v) => set('bitrate', v)}
            options={BITRATES.map((b) => ({
              value: b,
              label: t('tools.audio.bitrateValue', { kbps: b }),
            }))}
          />
        </Field>
      ) : null}
      <MoreSection label={t('tools.audio.more')}>
        <Field label={t('tools.audio.sampleRate')}>
          <ChipRow
            testIDPrefix="samplerate"
            value={value.sampleRate}
            onChange={(v) => set('sampleRate', v)}
            options={SAMPLE_RATES.map((r) => ({
              value: r,
              label: `${Number(r).toLocaleString()} Hz`,
            }))}
          />
        </Field>
        <Field label={t('tools.audio.channels')}>
          <ChipRow
            testIDPrefix="channels"
            value={value.channels}
            onChange={(v) => set('channels', v)}
            options={CHANNELS.map((c) => ({ value: c, label: t(`tools.audio.${c}`) }))}
          />
        </Field>
      </MoreSection>
    </View>
  );
}
