import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { useFactText } from '@/quota/useTierFacts';
import { Field } from '@/ui/components/Field';
import { ChipRow } from '@/ui/components/ChipRow';
import { NumberField } from '@/ui/components/NumberField';
import { Segmented } from '@/ui/components/Segmented';
import { ToggleRow } from '@/ui/components/ToggleRow';
import { Text } from '@/ui/components/Text';
import { FrameCropEditor } from '../../native/FrameCropEditor';
import { displaySize, initialRect } from '../../native/frameCropMath';
import { useScrubPlayer } from '../../native/useScrubPlayer';
import { useVideoFrame } from '../../native/useVideoThumbnails';
import {
  MAX_SIDE,
  TRANSFORM_FORMATS,
  heightOverLimit,
  type TransformForm,
  type TransformOp,
} from '../../options/video';
import type { ToolFormProps } from '../../types';
import { useFormatChips } from './shared';

const ROTATIONS = [0, 90, 180, 270] as const;

function CropStage({
  uri,
  durationSec,
  value,
  onChange,
}: { uri: string; durationSec?: number } & Pick<
  ToolFormProps<TransformForm>,
  'value' | 'onChange'
>) {
  const { player, duration, size } = useScrubPlayer(uri, durationSec);
  const frame = useVideoFrame(player, duration, (duration ?? 0) >= 1 ? 1 : 0);
  if (!frame || !size) return <View testID="crop-stage-loading" style={{ height: 120 }} />;
  const display = displaySize(size, { width: frame.width, height: frame.height });
  const rect = value.crop ?? initialRect(display.width, display.height, null);
  return (
    <FrameCropEditor
      source={frame}
      sourceWidth={display.width}
      sourceHeight={display.height}
      value={rect}
      onChange={(crop) => onChange({ ...value, crop })}
    />
  );
}

// i18n-keys: interface:videoTransform.rotations.90, interface:videoTransform.rotations.180, interface:videoTransform.rotations.270
export function VideoTransformForm({
  value,
  onChange,
  file,
  limits,
}: ToolFormProps<TransformForm>) {
  const limitMax = limits?.maxOutputHeight;
  const { t } = useTranslation();
  const set = (patch: Partial<TransformForm>) => onChange({ ...value, ...patch });
  const chips = useFormatChips(TRANSFORM_FORMATS, file?.extension, true);
  const fact = useFactText('maxOutputHeight');
  const over = heightOverLimit(value, { limits: { maxOutputHeight: limitMax } });
  const sideError = (n: number | null) =>
    n !== null && (n < 1 || n > MAX_SIDE)
      ? t('tools.video.transform.sideRange', { max: MAX_SIDE })
      : null;
  const heightHint = over
    ? [t('tools.video.transform.heightLimit', { limit: limitMax }), fact].filter(Boolean).join(' ')
    : null;

  return (
    <View className="gap-4" testID="video-transform-form">
      <Segmented<TransformOp>
        options={[
          { value: 'resize', label: t('tools.video.transform.op.resize') },
          { value: 'rotate', label: t('tools.video.transform.op.rotate') },
          { value: 'crop', label: t('tools.video.transform.op.crop') },
        ]}
        value={value.op}
        onChange={(op) => set({ op })}
      />
      {value.op === 'resize' ? (
        <View className="gap-4">
          <View className="flex-row gap-3">
            <View className="flex-1">
              <NumberField
                integer
                label={t('interface:videoTransform.widthLabel')}
                placeholder={t('interface:videoTransform.autoPlaceholder')}
                value={value.width}
                onValue={(width) => set({ width })}
                error={sideError(value.width)}
              />
            </View>
            <View className="flex-1">
              <NumberField
                integer
                label={t('interface:videoTransform.heightLabel')}
                placeholder={t('interface:videoTransform.autoPlaceholder')}
                value={value.height}
                onValue={(height) => set({ height })}
                error={heightHint ?? sideError(value.height)}
              />
            </View>
          </View>
          <Text className="text-sm text-subtle">{t('interface:videoTransform.resizeNote')}</Text>
          <ToggleRow
            label={t('interface:videoTransform.preserveAspect')}
            value={value.keepAspect}
            onChange={(keepAspect) => set({ keepAspect })}
          />
        </View>
      ) : null}
      {value.op === 'rotate' ? (
        <View className="gap-4">
          <Field label={t('interface:videoTransform.rotationLabel')}>
            <ChipRow
              options={ROTATIONS.map((r) => ({
                value: r,
                label:
                  r === 0
                    ? t('tools.video.transform.rotateNone')
                    : t(`interface:videoTransform.rotations.${r}`),
              }))}
              value={value.rotation}
              onChange={(rotation) => set({ rotation })}
            />
          </Field>
          <ToggleRow
            label={t('interface:videoTransform.flipH')}
            value={value.flipHorizontal}
            onChange={(flipHorizontal) => set({ flipHorizontal })}
          />
          <ToggleRow
            label={t('interface:videoTransform.flipV')}
            value={value.flipVertical}
            onChange={(flipVertical) => set({ flipVertical })}
          />
        </View>
      ) : null}
      {value.op === 'crop' && file?.uri ? (
        <CropStage
          uri={file.uri}
          durationSec={file.durationSec}
          value={value}
          onChange={onChange}
        />
      ) : null}
      <Field label={t('tools.video.format')}>
        <ChipRow options={chips} value={value.format} onChange={(format) => set({ format })} />
      </Field>
    </View>
  );
}
