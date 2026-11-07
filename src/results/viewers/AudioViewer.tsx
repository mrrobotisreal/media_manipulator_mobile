import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useEffect, useState } from 'react';
import { I18nManager, Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { trackResultCompare, trackResultPreviewed } from '@/analytics/resultEvents';
import { formatDuration } from '@/lib/format';
import { Button } from '@/ui/components/Button';
import { Num, Text } from '@/ui/components/Text';
import { wipeFromPointer } from '../compare/wipe';
import { useResultFile } from '../useResultFile';
import { LoadState } from './LoadState';
import { useStreamSource } from './streamSource';
import type { ViewerProps } from './types';

function Player({
  source,
  context,
  onError,
  original,
}: {
  source: { uri: string; headers?: Record<string, string> };
  context: ViewerProps['context'];
  onError: () => void;
  /** MA34: the recording a voice convert / shift started from, for the A/B toggle. */
  original?: { uri: string };
}) {
  const { t } = useTranslation();
  const resultPlayer = useAudioPlayer(source);
  const originalPlayer = useAudioPlayer(original ? { uri: original.uri } : null);
  const [side, setSide] = useState<'result' | 'original'>('result');
  const player = side === 'original' && original ? originalPlayer : resultPlayer;
  const otherPlayer = player === resultPlayer ? originalPlayer : resultPlayer;
  const status = useAudioPlayerStatus(player);
  const resultStatus = useAudioPlayerStatus(resultPlayer);
  const [width, setWidth] = useState(0);
  // A/B keeps the playback position: the other side seeks to where this one is, and plays on if it was playing.
  const pick = (next: 'result' | 'original') => {
    if (next === side || !original) return;
    const wasPlaying = status.playing;
    const at = status.currentTime;
    player.pause();
    void otherPlayer.seekTo(at);
    if (wasPlaying) otherPlayer.play();
    setSide(next);
    trackResultCompare(context, 'audio', 'toggle');
  };
  useEffect(() => {
    if (resultStatus.isLoaded) trackResultPreviewed(context, 'audio');
  }, [resultStatus.isLoaded, context]);
  useEffect(() => {
    if (resultStatus.playbackState === 'error') onError();
  }, [resultStatus.playbackState, onError]);

  const duration = status.duration > 0 ? status.duration : 0;
  const fraction = duration > 0 ? Math.min(1, status.currentTime / duration) : 0;
  const seek = (x: number) => {
    if (duration <= 0) return;
    const pct = wipeFromPointer(x, width, I18nManager.isRTL);
    void player.seekTo((pct / 100) * duration);
  };
  const gesture = Gesture.Pan()
    .minDistance(0)
    .onBegin((e) => seek(e.x))
    .onUpdate((e) => seek(e.x))
    .runOnJS(true);

  return (
    <View className="gap-3" testID="audio-player">
      <GestureDetector gesture={gesture}>
        <View
          onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
          accessibilityRole="adjustable"
          accessibilityLabel={t('interface:resultPanel.compareModes.seek')}
          className="h-6 justify-center"
        >
          <View className="h-1.5 overflow-hidden rounded-sm bg-surface-3">
            <View
              className="h-full bg-data"
              style={{
                width: `${fraction * 100}%`,
              }}
            />
          </View>
        </View>
      </GestureDetector>
      <View className="flex-row items-center justify-between">
        <Num className="text-sm text-muted-fg">{formatDuration(status.currentTime)}</Num>
        <Num className="text-sm text-muted-fg">{formatDuration(duration)}</Num>
      </View>
      {original ? (
        <View
          accessibilityRole="tablist"
          testID="audio-ab"
          className="flex-row rounded-md border border-edge bg-surface-2 p-0.5"
        >
          {(['original', 'result'] as const).map((k) => (
            <Pressable
              key={k}
              testID={`audio-ab-${k}`}
              accessibilityRole="tab"
              accessibilityState={{ selected: side === k }}
              accessibilityLabel={t(
                k === 'original'
                  ? 'interface:resultPanel.compareModes.audioOriginal'
                  : 'interface:resultPanel.compareModes.audioResult',
              )}
              onPress={() => pick(k)}
              className={`flex-1 items-center justify-center rounded-sm ${side === k ? 'bg-primary' : ''}`}
              style={{ minHeight: 44 }}
            >
              <Text className={side === k ? 'font-semibold text-on-primary' : 'text-muted-fg'}>
                {t(
                  k === 'original'
                    ? 'interface:resultPanel.original'
                    : 'interface:resultPanel.result',
                )}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      <Button
        label={
          status.playing
            ? t('interface:resultPanel.compareModes.pause')
            : t('interface:resultPanel.compareModes.play')
        }
        onPress={() => (status.playing ? player.pause() : player.play())}
      />
    </View>
  );
}

export function AudioViewer({ descriptor, context }: ViewerProps) {
  const { t } = useTranslation();
  const [fallback, setFallback] = useState(false);
  const [failed, setFailed] = useState(false);
  const audioOriginal = descriptor.original?.kind === 'audio' ? descriptor.original : undefined;
  const streaming = descriptor.mimeFromServer && !fallback;
  const stream = useStreamSource(descriptor.jobId, streaming);
  const file = useResultFile(
    descriptor.jobId,
    descriptor.fileName,
    descriptor.sizeBytes,
    !streaming,
  );
  if (failed) return <Text className="py-4 text-danger">{t('result.playFailed')}</Text>;
  if (streaming) {
    if (!stream)
      return <LoadState state={{ status: 'loading', progress: 0 }} onRetry={() => undefined} />;
    return (
      <Player
        source={stream}
        context={context}
        onError={() => setFallback(true)}
        original={audioOriginal}
      />
    );
  }
  if (file.state.status !== 'ready') return <LoadState state={file.state} onRetry={file.reload} />;
  return (
    <Player
      source={{ uri: file.state.file.uri }}
      context={context}
      onError={() => setFailed(true)}
      original={audioOriginal}
    />
  );
}
