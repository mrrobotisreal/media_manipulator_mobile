import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import { getJobEngine } from '@/jobs/runtime';
import { isServerActive, type JobRecord } from '@/jobs/types';
import { useBatchPosition, useJob } from '@/jobs/useJob';
import { Button } from '@/ui/components/Button';
import { Num, Text } from '@/ui/components/Text';
import { ProgressBar } from '@/ui/components/ProgressBar';
import { Screen } from '@/ui/components/Screen';

const TOOLS_TAB = '/(app)/(tabs)';
const pct = (n: number) => `${Math.round(n)}%`;

function Body({ job }: { job: JobRecord }) {
  const { t } = useTranslation();
  const engine = getJobEngine();
  switch (job.state) {
    case 'queued':
    case 'uploading':
    case 'finalizing':
      return (
        <View className="gap-3">
          <ProgressBar value={job.state === 'queued' ? undefined : job.uploadProgress} />
          <Num className="text-lg">
            {t('job.uploading', { percent: pct(job.uploadProgress * 100) })}
          </Num>
          <Button
            label={t('job.cancel')}
            variant="secondary"
            onPress={() => engine.cancel(job.localId)}
          />
        </View>
      );
    case 'pending':
    case 'processing':
      return (
        <View className="gap-3">
          <ProgressBar value={job.progress > 0 ? job.progress / 100 : undefined} accent="data" />
          <Num className="text-lg">{t('job.processing', { percent: pct(job.progress) })}</Num>
          {job.stage ? <Text className="text-sm text-subtle">{job.stage}</Text> : null}
          <Text className="text-muted-fg">{t('job.gpuNote')}</Text>
          <Text className="text-sm text-subtle">{t('job.stopWatchingBody')}</Text>
          <Button
            label={t('job.stopWatching')}
            variant="secondary"
            onPress={() => {
              engine.stopWatching(job.localId);
              router.replace(TOOLS_TAB);
            }}
          />
        </View>
      );
    case 'completed':
      // MA13 replaces this with the result viewer.
      return <Text>{t('job.completedPlaceholder')}</Text>;
    case 'upload_failed':
      return (
        <View className="gap-3">
          <Text className="text-danger">
            {job.error?.code === 'interrupted'
              ? t('job.interrupted')
              : job.error?.code === 'file_gone'
                ? t('job.fileGone')
                : t('job.state.upload_failed')}
          </Text>
          <Button label={t('job.retry')} onPress={() => engine.retry(job.localId)} />
        </View>
      );
    case 'lost':
      return <Text className="text-danger">{t('job.lost')}</Text>;
    case 'rejected':
      // MA16 renders the quota/limit sheets from `job.error`.
      return <Text className="text-danger">{t('job.rejectedBody')}</Text>;
    case 'failed':
    case 'cancelled':
    case 'stopped':
      return null;
  }
}

// i18n-keys: job.state.queued, job.state.uploading, job.state.finalizing, job.state.pending, job.state.processing, job.state.completed, job.state.failed, job.state.rejected, job.state.upload_failed, job.state.lost, job.state.cancelled, job.state.stopped
export default function JobRoute() {
  const { t } = useTranslation();
  const { jobId } = useLocalSearchParams<{ jobId: string }>();
  const job = useJob(typeof jobId === 'string' ? jobId : undefined);
  const batch = useBatchPosition(job);
  return (
    <Screen>
      <ScrollView contentContainerClassName="gap-4 p-4">
        {job ? (
          <>
            <Text className="text-xl font-semibold">{t(`job.state.${job.state}`)}</Text>
            {batch.count > 1 ? (
              <Num className="text-sm text-subtle">
                {t('job.queuePosition', { index: batch.index, count: batch.count })}
              </Num>
            ) : null}
            <Body job={job} />
            {isServerActive(job.state) ? null : (
              <Button
                label={t('common.back')}
                variant="ghost"
                onPress={() => router.replace(TOOLS_TAB)}
              />
            )}
          </>
        ) : (
          <>
            <Text className="text-muted-fg">{t('job.notFound')}</Text>
            <Button
              label={t('common.back')}
              variant="ghost"
              onPress={() => router.replace(TOOLS_TAB)}
            />
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
