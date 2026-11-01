import { useEvent } from 'expo';
import { VideoView, useVideoPlayer } from 'expo-video';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { trackResultPreviewed } from '@/analytics/resultEvents';
import { Text } from '@/ui/components/Text';
import { useResultFile } from '../useResultFile';
import { LoadState } from './LoadState';
import { useStreamSource } from './streamSource';
import type { ViewerProps } from './types';

function Player({
  source,
  onError,
  onReady,
}: {
  source: { uri: string; headers?: Record<string, string> };
  onError: () => void;
  onReady: () => void;
}) {
  const player = useVideoPlayer(source);
  const status = useEvent(player, 'statusChange', { status: player.status });
  useEffect(() => {
    if (status.status === 'readyToPlay') onReady();
    if (status.status === 'error') onError();
  }, [status.status, onError, onReady]);
  return (
    <VideoView
      player={player}
      nativeControls
      fullscreenOptions={{ enable: true }}
      contentFit="contain"
      style={{ width: '100%', aspectRatio: 16 / 9, borderRadius: 8 }}
    />
  );
}

/**
 * Streams `GET /api/result/:jobId` with owner headers (`VideoSource.headers`, verified in expo-video 57)
 * when the API sniffed a MIME; on a stream error, or without one, downloads first and plays the cache.
 */
export function VideoViewer({ descriptor, context }: ViewerProps) {
  const { t } = useTranslation();
  const [fallback, setFallback] = useState(false);
  const streaming = descriptor.mimeFromServer && !fallback;
  const stream = useStreamSource(descriptor.jobId, streaming);
  const file = useResultFile(
    descriptor.jobId,
    descriptor.fileName,
    descriptor.sizeBytes,
    !streaming,
  );
  const [failed, setFailed] = useState(false);
  const onReady = () => trackResultPreviewed(context, 'video');

  if (failed) return <Text className="py-4 text-danger">{t('result.playFailed')}</Text>;
  if (streaming) {
    if (!stream)
      return <LoadState state={{ status: 'loading', progress: 0 }} onRetry={() => undefined} />;
    return (
      <View testID="video-stream">
        <Player source={stream} onError={() => setFallback(true)} onReady={onReady} />
      </View>
    );
  }
  if (file.state.status !== 'ready') return <LoadState state={file.state} onRetry={file.reload} />;
  return (
    <View testID="video-file">
      <Player
        source={{ uri: file.state.file.uri }}
        onError={() => setFailed(true)}
        onReady={onReady}
      />
    </View>
  );
}
