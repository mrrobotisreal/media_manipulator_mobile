import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SvgUri } from 'react-native-svg';
import { trackResultPreviewed } from '@/analytics/resultEvents';
import { Num, Text } from '@/ui/components/Text';
import { Checkerboard } from '../Checkerboard';
import { ImageCompare } from '../compare/ImageCompare';
import { ZoomContainer, useZoomState } from '../ZoomContainer';
import { useResultFile } from '../useResultFile';
import { LoadState } from './LoadState';
import type { ViewerProps } from './types';

const HAS_ALPHA = new Set(['png', 'webp', 'avif', 'ico', 'svg']);

/** Downloads to the result cache, then a pinch-zoom image (SVG through `SvgUri`) with an optional compare. */
export function ImageViewer({ descriptor, context }: ViewerProps) {
  const { t } = useTranslation();
  const { state, reload } = useResultFile(
    descriptor.jobId,
    descriptor.fileName,
    descriptor.sizeBytes,
  );
  const zoom = useZoomState();
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const ext = descriptor.fileName.split('.').pop()?.toLowerCase() ?? '';
  const isSvg = ext === 'svg';

  useEffect(() => {
    if (isSvg && state.status === 'ready') trackResultPreviewed(context, 'image');
  }, [isSvg, state.status, context]);

  if (state.status !== 'ready') return <LoadState state={state} onRetry={reload} />;
  const uri = state.file.uri;

  if (descriptor.original) {
    return (
      <ImageCompare
        descriptor={descriptor}
        context={context}
        resultUri={uri}
        resultBytes={descriptor.sizeBytes ?? state.file.size}
        zoom={zoom}
      />
    );
  }

  return (
    <View className="gap-2">
      <ZoomContainer zoom={zoom} style={{ aspectRatio: 1, borderRadius: 8 }}>
        {HAS_ALPHA.has(ext) ? <Checkerboard /> : null}
        {isSvg ? (
          <SvgUri uri={uri} width="100%" height="100%" />
        ) : (
          <Image
            source={{ uri }}
            style={{ width: '100%', height: '100%' }}
            contentFit="contain"
            accessibilityLabel={t('interface:resultPanel.image.resultAlt', {
              fileName: descriptor.fileName,
            })}
            onLoad={(e) => {
              setDims({ w: e.source.width, h: e.source.height });
              trackResultPreviewed(context, 'image');
            }}
          />
        )}
      </ZoomContainer>
      {dims ? (
        <Num className="text-sm text-subtle">
          {t('interface:resultPanel.image.dimensions')}: {dims.w} × {dims.h}
        </Num>
      ) : (
        <Text className="text-sm text-subtle">{t('interface:resultPanel.image.zoom')}</Text>
      )}
    </View>
  );
}
