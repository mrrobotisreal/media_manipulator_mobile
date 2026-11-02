import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { useGetTranscriptQuery } from '@/api/endpoints/transcript';
import { trackResultPreviewed } from '@/analytics/resultEvents';
import { Button } from '@/ui/components/Button';
import { ProcessingIndicator } from '@/ui/components/ProcessingIndicator';
import { Text } from '@/ui/components/Text';
import { sourceFromTranscript } from '../transcriptModel';
import { AiSummary } from './AiSummary';
import { CaptionsViewer } from './CaptionsViewer';
import { TranscriptPanel } from './TranscriptPanel';
import type { ViewerProps } from './types';

/**
 * Kind `transcript`, and `captions` jobs from `transcribe`: prefers the JSON from `GET /api/transcript/:id`
 * so any export format is available whatever the chosen output. A 404 (or a contract mismatch) means "not
 * available" and falls back to downloading the result file itself (CaptionsViewer) when it is a caption file.
 */
export function TranscriptViewer({ descriptor, context }: ViewerProps) {
  const { t } = useTranslation();
  const q = useGetTranscriptQuery(descriptor.jobId);
  const source = useMemo(() => (q.data ? sourceFromTranscript(q.data) : null), [q.data]);

  useEffect(() => {
    if (source) trackResultPreviewed(context, 'transcript');
  }, [source, context]);

  if (q.isLoading || q.isUninitialized) {
    return (
      <View className="items-center gap-2 py-8" testID="transcript-loading">
        <ProcessingIndicator label={t('interface:resultPanel.loading')} />
        <Text className="text-muted-fg">{t('interface:transcribeResultView.loading')}</Text>
      </View>
    );
  }
  if (!q.data || !source) {
    const ext = descriptor.fileName.split('.').pop()?.toLowerCase();
    if (ext === 'srt' || ext === 'vtt')
      return <CaptionsViewer descriptor={descriptor} context={context} />;
    return (
      <View className="items-start gap-3 py-4" testID="transcript-unavailable">
        <Text className="text-muted-fg">{t('result.transcript.unavailable')}</Text>
        <Button
          variant="secondary"
          label={t('interface:resultPanel.retry')}
          onPress={() => void q.refetch()}
        />
      </View>
    );
  }
  const r = q.data;
  return (
    <TranscriptPanel
      source={source}
      fileName={descriptor.fileName}
      jobId={descriptor.jobId}
      emptyReason={!r.hasAudio ? 'noAudio' : !r.hasSpeech ? 'noSpeech' : null}
    >
      {r.hasAudio && r.hasSpeech ? <AiSummary jobId={descriptor.jobId} /> : null}
    </TranscriptPanel>
  );
}
