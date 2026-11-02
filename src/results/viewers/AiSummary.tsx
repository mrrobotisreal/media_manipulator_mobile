import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { ANALYSIS_POLL_MS, useGetAnalysisQuery } from '@/api/endpoints/transcript';
import type { AnalysisResult } from '@/api/schemas/transcript';
import { Panel } from '@/ui/components/Panel';
import { Text } from '@/ui/components/Text';
import { analysisUiState } from '../analysisPolling';

export function AiSummaryCard({ review }: { review: NonNullable<AnalysisResult['transcriptReview']> }) {
  const { t } = useTranslation();
  const safety = review.content_safety?.rating;
  return (
    <View className="gap-2" testID="ai-summary">
      {review.summary ? <Text>{review.summary}</Text> : null}
      {review.extended_summary ? (
        <Text className="text-sm text-muted-fg">{review.extended_summary}</Text>
      ) : null}
      {review.main_topics?.length ? (
        <Text className="text-sm">
          <Text className="text-sm font-semibold">{t('result.transcript.topics')}: </Text>
          {review.main_topics.join(', ')}
        </Text>
      ) : null}
      {review.keywords?.length ? (
        <Text className="text-sm">
          <Text className="text-sm font-semibold">{t('result.transcript.keywords')}: </Text>
          {review.keywords.join(', ')}
        </Text>
      ) : null}
      {review.sentiment_label ? (
        <Text className="text-sm text-muted-fg">
          {t('result.transcript.sentiment')}: {review.sentiment_label}
        </Text>
      ) : null}
      {safety ? (
        <Text className="text-sm text-muted-fg">
          {t('result.transcript.safety')}: {safety}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * `GET /api/analysis/:id` is 404 until the background job finishes: RTK Query polls every 4 s for at most
 * 5 minutes, then shows "Summary not available". Polling stops on unmount (RTK Query unsubscribes).
 */
export function AiSummary({ jobId }: { jobId: string }) {
  const { t } = useTranslation();
  const startedAt = useRef(Date.now());
  const [now, setNow] = useState(() => Date.now());
  const [polling, setPolling] = useState(ANALYSIS_POLL_MS);
  const q = useGetAnalysisQuery(jobId, { pollingInterval: polling });
  const review = q.data?.transcriptReview;
  const state = analysisUiState(Boolean(review), startedAt.current, now);

  useEffect(() => {
    setPolling(state === 'running' ? ANALYSIS_POLL_MS : 0);
  }, [state]);

  useEffect(() => {
    if (state !== 'running') return;
    const h = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(h);
  }, [state]);

  return (
    <Panel title={t('result.transcript.summaryTitle')}>
      {state === 'ready' && review ? (
        <AiSummaryCard review={review} />
      ) : state === 'running' ? (
        <Text className="text-muted-fg" testID="summary-running">
          {t('result.transcript.summaryRunning')}
        </Text>
      ) : (
        <Text className="text-muted-fg" testID="summary-unavailable">
          {t('result.transcript.summaryUnavailable')}
        </Text>
      )}
    </Panel>
  );
}
