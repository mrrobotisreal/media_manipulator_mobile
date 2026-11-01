import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { I18nManager, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import {
  trackResultCompare,
  type ResultCompareMode,
  ResultContext,
} from '@/analytics/resultEvents';
import { formatBytes } from '@/lib/format';
import { Num, Text } from '@/ui/components/Text';
import { Segmented } from '@/ui/components/Segmented';
import { Checkerboard } from '../Checkerboard';
import { ZoomContainer, type ZoomState } from '../ZoomContainer';
import type { ResultDescriptor } from '../describe';
import { clampWipe, formatDelta, stepWipe, wipeFromPointer } from './wipe';
import { File } from 'expo-file-system';

const fill = { width: '100%', height: '100%' } as const;

/**
 * Original vs result from the cached original (never fetched). Wipe: a drag handle in logical coordinates
 * (0 % = start edge). Toggle: tap to flip. Both layers share one zoom transform.
 */
export function ImageCompare({
  descriptor,
  context,
  resultUri,
  resultBytes,
  zoom,
}: {
  descriptor: ResultDescriptor;
  context: ResultContext;
  resultUri: string;
  resultBytes?: number;
  zoom: ZoomState;
}) {
  const { t } = useTranslation();
  const original = descriptor.original!;
  const [mode, setMode] = useState<ResultCompareMode>('wipe');
  const [pct, setPct] = useState(50);
  const [width, setWidth] = useState(0);
  const [showOriginal, setShowOriginal] = useState(true);
  const isRtl = I18nManager.isRTL;

  useEffect(() => {
    trackResultCompare(context, descriptor.kind, mode);
  }, [mode, context, descriptor.kind]);

  let originalBytes: number | undefined;
  try {
    originalBytes = new File(original.uri).size || undefined;
  } catch {
    originalBytes = undefined;
  }
  const delta = formatDelta(originalBytes, resultBytes);

  const drag = Gesture.Pan()
    .minDistance(0)
    .enabled(mode === 'wipe')
    .onBegin((e) => setPct(wipeFromPointer(e.x, width, isRtl)))
    .onUpdate((e) => setPct(wipeFromPointer(e.x, width, isRtl)))
    .runOnJS(true);

  const handleStart = `${clampWipe(pct)}%` as const;
  const wipeActive = mode === 'wipe';

  return (
    <View className="gap-3" testID="image-compare">
      <Segmented<ResultCompareMode>
        options={[
          { value: 'wipe', label: t('interface:resultPanel.compareModes.wipe') },
          { value: 'toggle', label: t('interface:resultPanel.compareModes.toggle') },
        ]}
        value={mode}
        onChange={setMode}
      />
      <ZoomContainer
        zoom={zoom}
        style={{ aspectRatio: 1, borderRadius: 8 }}
        onTap={mode === 'toggle' ? () => setShowOriginal((v) => !v) : undefined}
      >
        <Checkerboard />
        <Image source={{ uri: resultUri }} style={fill} contentFit="contain" />
        {wipeActive || showOriginal ? (
          <View
            testID="compare-original-layer"
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              start: 0,
              width: wipeActive ? handleStart : '100%',
              overflow: 'hidden',
            }}
          >
            <View style={{ position: 'absolute', top: 0, bottom: 0, start: 0, width }}>
              <Image source={{ uri: original.uri }} style={fill} contentFit="contain" />
            </View>
          </View>
        ) : null}
        {wipeActive ? (
          <View
            testID="compare-handle"
            accessibilityRole="adjustable"
            accessibilityLabel={t('interface:resultPanel.compareModes.slider')}
            accessibilityValue={{ text: `${Math.round(pct)}%` }}
            accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
            onAccessibilityAction={(e) =>
              setPct((p) => stepWipe(p, e.nativeEvent.actionName as 'increment' | 'decrement'))
            }
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              start: handleStart,
              width: 2,
              marginStart: -1,
              backgroundColor: '#ECEFF4',
            }}
          />
        ) : null}
      </ZoomContainer>
      {wipeActive ? (
        <GestureDetector gesture={drag}>
          <View
            testID="compare-drag-strip"
            onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
            className="h-10 justify-center rounded-md bg-surface-2"
          >
            <View
              className="h-1.5 rounded-sm bg-primary"
              style={{ width: handleStart, alignSelf: 'flex-start' }}
            />
          </View>
        </GestureDetector>
      ) : (
        <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} />
      )}
      <View className="flex-row items-center justify-between gap-3">
        <Text className="rounded-sm bg-surface-2 px-2 py-1 text-xs">
          {mode === 'toggle' && !showOriginal
            ? t('interface:resultPanel.result')
            : t('interface:resultPanel.original')}
        </Text>
        {delta ? (
          <Num className="text-sm text-data">{t('result.sizeDelta', { delta })}</Num>
        ) : originalBytes !== undefined ? (
          <Num className="text-sm text-muted-fg">{formatBytes(originalBytes)}</Num>
        ) : null}
      </View>
    </View>
  );
}
