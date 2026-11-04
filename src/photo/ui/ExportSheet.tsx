/**
 * Export (ticket MA50 decision 8, design PHOTO_EDITOR_MOBILE.md §2): format (from capabilities),
 * quality, metadata keep/strip, a size estimate, and Max size Original / 12 / 24 / 64 / 120 MP with
 * the sizes above the plan's cap disabled and the neutral line "Exports up to {{mp}} MP on your
 * plan" (MA-0008: no price, no purchase link). Export hands a `photoExport` starter job to MA12 and
 * opens its job screen (MA13 result, MA14 save).
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import {
  PHOTO_EXPORT_FORMATS,
  type PhotoCapabilities,
  type PhotoExportFormat,
} from '@/api/schemas/photo';
import { Button } from '@/ui/components/Button';
import { Chips } from '@/ui/components/Chips';
import { Segmented } from '@/ui/components/Segmented';
import { Sheet } from '@/ui/components/Sheet';
import { Text } from '@/ui/components/Text';
import {
  effectiveMegapixels,
  estimateExportBytes,
  formatBytes,
  isSizeLocked,
  MAX_SIZE_OPTIONS,
  megapixelsOf,
  qualityApplies,
  type ExportChoice,
  type MaxSizeOption,
} from '../exportPlan';
import type { PhotoDoc } from '../photoTypes';
import { ParamSlider } from './ParamSlider';

const LABEL: Record<PhotoExportFormat, string> = {
  jpg: 'JPG',
  png: 'PNG',
  webp: 'WebP',
  avif: 'AVIF',
  tiff: 'TIFF',
};

export function ExportSheet({
  visible,
  onClose,
  doc,
  capabilities,
  ready,
  onExport,
  busy,
  onLockedSize,
}: {
  visible: boolean;
  onClose: () => void;
  doc: PhotoDoc;
  capabilities: PhotoCapabilities | undefined;
  /** The project exists (the upload finished). */
  ready: boolean;
  onExport: (choice: ExportChoice) => void;
  busy?: boolean;
  /** MA52: a locked Max size was pressed (`photo_export_gated` reason megapixels); MP of the size. */
  onLockedSize?: (megapixels: number) => void;
}) {
  const { t } = useTranslation();
  const formats = (
    capabilities?.formats?.length ? capabilities.formats : ['jpg', 'png', 'webp']
  ).filter((f): f is PhotoExportFormat => (PHOTO_EXPORT_FORMATS as readonly string[]).includes(f));
  const [choice, setChoice] = useState<ExportChoice>({
    format: (doc.output.format as PhotoExportFormat | undefined) ?? 'jpg',
    quality: doc.output.quality ?? 92,
    metadataMode: doc.output.metadataMode ?? 'keep',
    maxSize: 0,
  });
  const cap = capabilities?.maxMegapixels ?? 12;
  const original = megapixelsOf(doc);
  const mp = effectiveMegapixels(doc, choice.maxSize, cap);
  const renderReady = capabilities?.render === true;
  const sizes = MAX_SIZE_OPTIONS.map((o) => ({
    value: o,
    label:
      o === 0 ? t('interface:photo.export.original') : t('interface:photo.export.mp', { mp: o }),
    locked: isSizeLocked(o, cap, original),
  }));
  // The default must not sit on a locked option (a free plan with a 24 MP photo: 12 MP).
  const firstOpen = sizes.find((s) => !s.locked)?.value ?? 12;
  const maxSize: MaxSizeOption = isSizeLocked(choice.maxSize, cap, original)
    ? (firstOpen as MaxSizeOption)
    : choice.maxSize;
  const set = (p: Partial<ExportChoice>) => setChoice((c) => ({ ...c, ...p }));

  return (
    <Sheet visible={visible} onClose={onClose}>
      <View className="gap-3" testID="photo-export-sheet">
        <Text className="text-lg font-semibold">{t('photo.export.title')}</Text>
        <Text className="text-sm text-muted-fg">{t('interface:photo.export.format')}</Text>
        <Chips
          options={formats.map((f) => ({ value: f, label: LABEL[f] }))}
          value={choice.format}
          onChange={(format) => set({ format })}
          testIDPrefix="photo-export-format"
        />
        {qualityApplies(choice.format) ? (
          <ParamSlider
            label={t('interface:photo.export.quality')}
            value={choice.quality}
            min={1}
            max={100}
            defaultValue={92}
            undoLabel="export"
            onValue={(quality) => set({ quality })}
          />
        ) : null}
        <Text className="text-sm text-muted-fg">{t('interface:photo.export.metadata')}</Text>
        <Segmented
          options={[
            { value: 'keep', label: t('interface:photo.export.metadataKeep') },
            { value: 'strip', label: t('interface:photo.export.metadataStrip') },
          ]}
          value={choice.metadataMode}
          onChange={(metadataMode) => set({ metadataMode })}
        />
        <Text className="text-sm text-muted-fg">{t('interface:photo.export.maxSize')}</Text>
        <Chips
          options={sizes}
          value={maxSize}
          onChange={(o) => set({ maxSize: o })}
          onLockedPress={(o) => onLockedSize?.(o === 0 ? original : o)}
          testIDPrefix="photo-export-size"
        />
        {cap > 0 ? (
          <Text className="text-sm text-subtle">{t('photo.export.mpCap', { mp: cap })}</Text>
        ) : null}
        <Text className="text-sm" testID="photo-export-estimate">
          {t('photo.export.estimate', {
            size: formatBytes(estimateExportBytes(choice.format, choice.quality, mp)),
          })}
        </Text>
        {!renderReady ? (
          <Text className="text-sm text-subtle">{t('photo.export.unavailable')}</Text>
        ) : null}
        {renderReady && !ready ? (
          <Text className="text-sm text-subtle">{t('photo.export.uploadFirst')}</Text>
        ) : null}
        <Button
          testID="photo-export-start"
          label={t('photo.export.start')}
          disabled={!renderReady || !ready}
          loading={busy}
          onPress={() => onExport({ ...choice, maxSize })}
        />
      </View>
    </Sheet>
  );
}
