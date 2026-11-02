import { Image } from 'expo-image';
import { useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { detectFaces, realDetectDeps } from '@/api/endpoints/ai';
import { track } from '@/analytics/track';
import { Button } from '@/ui/components/Button';
import { Chips } from '@/ui/components/Chips';
import { Text } from '@/ui/components/Text';
import type { FacePickerProps } from '../../native/FacePicker';
import type { RectDrawerProps } from '../../native/RectDrawer';
import {
  BACKGROUND_MODELS,
  UPSCALE_MODELS,
  blurFacesBlockReason,
  detectionFor,
  sameImageFormat,
  type BlurFacesForm as BlurFacesState,
  type FaceSelectionMode,
  type FaceStyle,
  type RedactTextForm as RedactState,
  type RemoveBackgroundForm as RemoveBackgroundState,
  type RemoveObjectForm as RemoveObjectState,
  type TextDetect,
  type TextRedaction,
  type UpscaleForm as UpscaleState,
} from '../../options/ai';
import type { ToolContext, ToolFormProps } from '../../types';
import { FieldLabel } from '../image/shared';
import { faceCountBucket, toDetectionState } from './faceSession';

/** Lazy: keeps lucide/gesture-handler out of the registry import graph (jest never loads the native runtime). */
function FacePicker(props: FacePickerProps) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const C = require('../../native/FacePicker')
    .FacePicker as typeof import('../../native/FacePicker').FacePicker;
  return <C {...props} />;
}
function RectDrawer(props: RectDrawerProps) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const C = require('../../native/RectDrawer')
    .RectDrawer as typeof import('../../native/RectDrawer').RectDrawer;
  return <C {...props} />;
}

/** Output is "same as original" for the three image tools that keep the user's format. */
function SameFormatLine({ ctx }: { ctx?: ToolContext }) {
  const { t } = useTranslation();
  const format = sameImageFormat(ctx?.input?.extension);
  return (
    <View className="gap-1">
      <FieldLabel>{t('tools.image.format')}</FieldLabel>
      <Text>{t('tools.image.sameAsOriginal', { format: t(`tools.image.formats.${format}`) })}</Text>
    </View>
  );
}

export function RemoveBackgroundForm({ value, onChange }: ToolFormProps<RemoveBackgroundState>) {
  const { t } = useTranslation();
  return (
    <View className="gap-3">
      <Text className="text-sm text-muted-fg">
        {t('interface:imageForm.ai.background.pngNote')}
      </Text>
      <FieldLabel>{t('interface:imageForm.ai.background.modelLabel')}</FieldLabel>
      <Chips
        options={BACKGROUND_MODELS.map((m) => ({
          value: m,
          label: t(`interface:imageForm.ai.background.models.${m}`),
        }))}
        value={value.model}
        onChange={(model) => onChange({ ...value, model })}
      />
    </View>
  );
}

export function UpscaleForm({ value, onChange }: ToolFormProps<UpscaleState>) {
  const { t } = useTranslation();
  return (
    <View className="gap-3">
      <FieldLabel>{t('interface:imageForm.ai.upscale.scaleLabel')}</FieldLabel>
      <Chips
        options={[
          { value: 2, label: t('interface:imageForm.ai.upscale.scale2x') },
          { value: 4, label: t('interface:imageForm.ai.upscale.scale4x') },
        ]}
        value={value.scale}
        onChange={(scale) => onChange({ ...value, scale: scale as 2 | 4 })}
      />
      <FieldLabel>{t('interface:imageForm.ai.upscale.modelLabel')}</FieldLabel>
      <Chips
        options={UPSCALE_MODELS.map((m) => ({
          value: m,
          label: t(`interface:imageForm.ai.upscale.models.${m}`),
        }))}
        value={value.model}
        onChange={(model) => onChange({ ...value, model })}
      />
      <Text className="text-sm text-subtle">{t('interface:imageForm.ai.upscale.pngNote')}</Text>
    </View>
  );
}

const FACE_STYLES: FaceStyle[] = ['blur', 'pixelate', 'blackbox'];
const FACE_MODES: FaceSelectionMode[] = ['all', 'only_selected', 'all_except_selected'];

export function BlurFacesForm({ value, onChange, ctx }: ToolFormProps<BlurFacesState>) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const uri = ctx?.input?.uri;
  const detection = detectionFor(value, ctx);
  const reason = blurFacesBlockReason(value, ctx);

  const find = async () => {
    if (!uri || busy) return;
    setBusy(true);
    setFailed(false);
    const res = await detectFaces({ uri, mimeType: ctx?.input?.mime ?? '' }, realDetectDeps());
    setBusy(false);
    if (!res.ok) {
      setFailed(true);
      track('feature_used', { feature: 'face_detect', action: 'failed' });
      return;
    }
    const next = toDetectionState(res.data, uri);
    track('feature_used', {
      feature: 'face_detect',
      action: 'detected',
      value: faceCountBucket(next.faces.length),
    });
    onChange({ ...value, detection: next, selected: [] });
  };

  const toggle = (id: string) =>
    onChange({
      ...value,
      selected: value.selected.includes(id)
        ? value.selected.filter((x) => x !== id)
        : [...value.selected, id],
    });

  return (
    <View className="gap-3">
      <FieldLabel>{t('interface:imageForm.ai.faceMode.label')}</FieldLabel>
      <Chips
        options={FACE_STYLES.map((s) => ({
          value: s,
          label: t(`interface:imageForm.ai.faceMode.${s}`),
        }))}
        value={value.style}
        onChange={(style) => onChange({ ...value, style })}
      />
      <FieldLabel>{t('interface:imageForm.ai.selectiveFaces.selectionModeLabel')}</FieldLabel>
      <Chips
        options={FACE_MODES.map((m) => ({
          value: m,
          label: t(`interface:imageForm.ai.selectiveFaces.selectionMode.${m}`),
        }))}
        value={value.selectionMode}
        onChange={(selectionMode) => onChange({ ...value, selectionMode })}
      />
      {value.selectionMode !== 'all' ? (
        <View className="gap-3">
          <Button
            variant="secondary"
            label={
              busy
                ? t('tools.ai.faces.finding')
                : detection
                  ? t('tools.ai.faces.refind')
                  : t('tools.ai.faces.find')
            }
            loading={busy}
            disabled={!uri}
            onPress={() => void find()}
          />
          {failed ? (
            <Text className="text-sm text-danger" accessibilityLiveRegion="polite">
              {t('tools.ai.faces.detectFailed')}
            </Text>
          ) : null}
          {detection && uri ? (
            <FacePicker
              uri={uri}
              imageWidth={detection.imageWidth}
              imageHeight={detection.imageHeight}
              faces={detection.faces}
              selected={value.selected}
              onToggle={toggle}
              onSelectAll={() => onChange({ ...value, selected: detection.faces.map((f) => f.id) })}
              onClear={() => onChange({ ...value, selected: [] })}
            />
          ) : null}
          {reason === 'needs_detection' ? (
            <Text className="text-sm text-muted-fg">{t('tools.ai.faces.needDetection')}</Text>
          ) : null}
          {reason === 'select_faces' ? (
            <Text className="text-sm text-muted-fg">{t('tools.ai.faces.pickSome')}</Text>
          ) : null}
        </View>
      ) : (
        <Text className="text-sm text-subtle">
          {t('interface:imageForm.ai.selectiveFaces.defaultNote')}
        </Text>
      )}
      <SameFormatLine ctx={ctx} />
    </View>
  );
}

const DETECTS: TextDetect[] = ['pii', 'all-text'];
const REDACTIONS: TextRedaction[] = ['blackbox', 'blur', 'pixelate'];

export function RedactTextForm({ value, onChange, ctx }: ToolFormProps<RedactState>) {
  const { t } = useTranslation();
  return (
    <View className="gap-3">
      <FieldLabel>{t('interface:imageForm.ai.redact.detectLabel')}</FieldLabel>
      <Chips
        options={DETECTS.map((d) => ({
          value: d,
          label: t(`interface:imageForm.ai.redact.detect.${d}`),
        }))}
        value={value.detect}
        onChange={(detect) => onChange({ ...value, detect })}
      />
      <FieldLabel>{t('interface:imageForm.ai.redact.redactionLabel')}</FieldLabel>
      <Chips
        options={REDACTIONS.map((r) => ({
          value: r,
          label: t(`interface:imageForm.ai.redact.redaction.${r}`),
        }))}
        value={value.style}
        onChange={(style) => onChange({ ...value, style })}
      />
      <Text className="text-sm text-subtle">{t('interface:imageForm.ai.redact.ocrNote')}</Text>
      <SameFormatLine ctx={ctx} />
    </View>
  );
}

export function RemoveObjectForm({ value, onChange, ctx }: ToolFormProps<RemoveObjectState>) {
  const { t } = useTranslation();
  const uri = ctx?.input?.uri;
  // expo-image reports the EXIF-oriented size, which is the image the server measures.
  const [loaded, setLoaded] = useState<{ width: number; height: number; uri: string } | null>(null);
  if (!uri) {
    return (
      <Text className="text-sm text-muted-fg">
        {t('interface:imageForm.ai.removeObject.chooseFile')}
      </Text>
    );
  }
  const size = loaded && loaded.uri === uri ? loaded : null;
  return (
    <View className="gap-3">
      {!size ? (
        <Image
          source={{ uri }}
          style={{ width: 1, height: 1, opacity: 0 }}
          onLoad={(e) => setLoaded({ width: e.source.width, height: e.source.height, uri })}
        />
      ) : (
        <RectDrawer
          uri={uri}
          aspect={size.width / size.height}
          rects={value.rects}
          onChange={(rects) => onChange({ ...value, rects })}
        />
      )}
      {value.rects.length === 0 ? (
        <Text className="text-sm text-muted-fg">{t('tools.ai.rects.needOne')}</Text>
      ) : null}
      <SameFormatLine ctx={ctx} />
    </View>
  );
}
