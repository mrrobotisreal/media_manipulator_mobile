import { Image } from 'expo-image';
import { useRef, useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { trackResultPreviewed } from '@/analytics/resultEvents';
import { Button } from '@/ui/components/Button';
import { ZoomContainer, useZoomState } from '../ZoomContainer';
import { useResultFile } from '../useResultFile';
import { LoadState } from './LoadState';
import type { ViewerProps } from './types';

export function GifViewer({ descriptor, context }: ViewerProps) {
  const { t } = useTranslation();
  const { state, reload } = useResultFile(
    descriptor.jobId,
    descriptor.fileName,
    descriptor.sizeBytes,
  );
  const zoom = useZoomState();
  const ref = useRef<Image>(null);
  const [playing, setPlaying] = useState(true);
  if (state.status !== 'ready') return <LoadState state={state} onRetry={reload} />;
  const toggle = () => {
    const next = !playing;
    setPlaying(next);
    void (next ? ref.current?.startAnimating() : ref.current?.stopAnimating());
  };
  return (
    <View className="gap-2">
      <ZoomContainer zoom={zoom} style={{ aspectRatio: 1, borderRadius: 8 }}>
        <Image
          ref={ref}
          source={{ uri: state.file.uri }}
          style={{ width: '100%', height: '100%' }}
          contentFit="contain"
          autoplay
          accessibilityLabel={t('interface:resultPanel.gif.alt', { fileName: descriptor.fileName })}
          onLoad={() => trackResultPreviewed(context, 'gif')}
        />
      </ZoomContainer>
      <Button
        label={
          playing
            ? t('interface:resultPanel.compareModes.pause')
            : t('interface:resultPanel.compareModes.play')
        }
        variant="secondary"
        onPress={toggle}
      />
    </View>
  );
}
