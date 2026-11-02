import type { TFunction } from 'i18next';
import type { ChipOption } from '@/ui/components/Chips';
import type { AudioFormat, FormatChoice } from '../../options/audio';

export const FORMAT_LABEL: Record<AudioFormat, string> = {
  mp3: 'MP3',
  wav: 'WAV',
  aac: 'AAC',
  ogg: 'OGG',
  flac: 'FLAC',
  alac: 'ALAC',
  opus: 'Opus',
};

/** "Same as original (MP3)" first, then the explicit formats. */
export function formatChoiceOptions(
  t: TFunction,
  extension: string | undefined,
  formats: readonly AudioFormat[],
  resolve: (ext: string | undefined) => AudioFormat,
): ChipOption<FormatChoice>[] {
  return [
    {
      value: 'same',
      label: t('tools.audio.sameAsOriginal', { format: FORMAT_LABEL[resolve(extension)] }),
    },
    ...formats.map((f) => ({ value: f as FormatChoice, label: FORMAT_LABEL[f] })),
  ];
}
