import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import { analyticsMediaKind, getTool } from '@/tools/registry';
import { getJobEngine } from '@/jobs/runtime';
import { isServerActive, type JobRecord } from '@/jobs/types';
import { useBatchPosition, useJob } from '@/jobs/useJob';
import { failureKeyFor } from '@/results/failureCopy';
import { ResultBody, type ResultSource } from '@/results/ResultBody';
import { jobFromEntry, reopenableEntry } from '@/history/reopenFallback';
import { useRemoteJob } from '@/results/useRemoteJob';
import { Button } from '@/ui/components/Button';
import { Num, Text } from '@/ui/components/Text';
import { ProcessingIndicator } from '@/ui/components/ProcessingIndicator';
import { ProgressBar } from '@/ui/components/ProgressBar';
import { Screen } from '@/ui/components/Screen';

const TOOLS_TAB = '/(app)/(tabs)';
const HISTORY_TAB = '/(app)/(tabs)/history' as Href;
const pct = (n: number) => `${Math.round(n)}%`;

/** Registry-derived context for a local record; the descriptor and analytics read it. */
function sourceFor(job: JobRecord): ResultSource | null {
  if (!job.job) return null;
  const tool = getTool(job.toolId);
  return {
    job: job.job,
    webTask: tool?.webTask,
    resultHint: tool?.resultHint,
    toolSlug: job.analyticsSlug,
    mediaKind: tool ? analyticsMediaKind(tool) : undefined,
    tool: tool
      ? { id: tool.id, family: tool.family, kind: tool.accepts.kinds[0] ?? 'image' }
      : undefined,
  };
}

function ProgressBody({ job }: { job: JobRecord }) {
  const { t } = useTranslation();
  const engine = getJobEngine();
  const tool = getTool(job.toolId);
  if (job.state === 'queued' || job.state === 'uploading' || job.state === 'finalizing') {
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
  }
  return (
    <View className="gap-3">
      <View className="flex-row items-center gap-3">
        <ProcessingIndicator />
        <Num className="text-lg">{t('job.processing', { percent: pct(job.progress) })}</Num>
      </View>
      <ProgressBar value={job.progress > 0 ? job.progress / 100 : undefined} accent="data" />
      {job.stage ? <Text className="text-sm text-subtle">{job.stage}</Text> : null}
      {tool?.gpu ? <Text className="text-muted-fg">{t('job.gpuNote')}</Text> : null}
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
}

function FailureBody({ job }: { job: JobRecord }) {
  const { t } = useTranslation();
  const engine = getJobEngine();
  const tool = getTool(job.toolId);
  const key = failureKeyFor(job);
  return (
    <View className="gap-3" testID="result-failure">
      <Text className="text-danger">{t(`result.failed.${key}`)}</Text>
      {job.state === 'rejected' ? (
        // MA16 opens the quota/limit sheet from `job.error`; no-op until then.
        <Button label={t('result.details')} variant="ghost" onPress={() => undefined} />
      ) : null}
      {job.state === 'upload_failed' ? (
        <Button label={t('job.retry')} onPress={() => engine.retry(job.localId)} />
      ) : null}
      {tool && job.state !== 'upload_failed' ? (
        <Button
          label={t('result.backToTool')}
          variant="secondary"
          onPress={() => router.replace(`/(app)/tool/${tool.family}/${tool.id}` as Href)}
        />
      ) : null}
    </View>
  );
}

// i18n-keys: result.failed.generic, result.failed.processing, result.failed.rejected, result.failed.quota, result.failed.tooLarge, result.failed.unsupported, result.failed.unreadable, result.failed.noAudio, result.failed.network, result.failed.timeout, result.failed.rateLimited, result.failed.auth, result.failed.interrupted, result.failed.fileGone, result.failed.lost, result.failed.cancelled, result.failed.stopped, job.state.queued, job.state.uploading, job.state.finalizing, job.state.pending, job.state.processing, job.state.completed, job.state.failed, job.state.rejected, job.state.upload_failed, job.state.lost, job.state.cancelled, job.state.stopped
export default function JobRoute() {
  const { t } = useTranslation();
  const { jobId, from } = useLocalSearchParams<{ jobId: string; from?: string }>();
  const id = typeof jobId === 'string' ? jobId : undefined;
  const surface = from === 'history' ? 'history' : 'tool_page';
  const job = useJob(id);
  const batch = useBatchPosition(job);
  const remote = useRemoteJob(id, !job);
  const back = () => router.replace(TOOLS_TAB);

  let body: React.ReactNode;
  let title: string | null = null;
  if (job) {
    title = t(`job.state.${job.state}`);
    const source = job.state === 'completed' ? sourceFor(job) : null;
    if (job.state === 'completed' && source) {
      body = <ResultBody source={source} surface={surface} />;
    } else if (
      job.state === 'queued' ||
      job.state === 'uploading' ||
      job.state === 'finalizing' ||
      isServerActive(job.state)
    ) {
      body = <ProgressBody job={job} />;
    } else {
      body = <FailureBody job={job} />;
    }
  } else if (remote.status === 'ready') {
    if (remote.job.status === 'completed') {
      title = t('job.state.completed');
      body = <ResultBody source={{ job: remote.job }} surface={surface} />;
    } else if (remote.job.status === 'failed') {
      title = t('job.state.failed');
      body = <Text className="text-danger">{t('result.failed.processing')}</Text>;
    } else {
      title = t('job.state.processing');
      body = <Text className="text-muted-fg">{t('result.stillRunning')}</Text>;
    }
  } else if (remote.status === 'loading') {
    body = <ProcessingIndicator />;
  } else if (remote.status === 'missing' && reopenableEntry(id)) {
    // History opened a result the server's in-memory job map no longer has: the row is enough to download it.
    const entry = reopenableEntry(id)!;
    title = t('job.state.completed');
    body = <ResultBody source={{ job: jobFromEntry(entry) }} surface={surface} />;
  } else if (remote.status === 'missing') {
    body = (
      <View className="gap-3" testID="result-not-on-server">
        <Text className="text-muted-fg">{t('result.notOnServer')}</Text>
        <Button
          label={t('result.openHistory')}
          variant="secondary"
          onPress={() => router.replace(HISTORY_TAB)}
        />
      </View>
    );
  } else {
    body = <Text className="text-muted-fg">{t('job.notFound')}</Text>;
  }

  return (
    <Screen>
      <ScrollView contentContainerClassName="gap-4 p-4">
        {title ? <Text className="text-xl font-semibold">{title}</Text> : null}
        {job && batch.count > 1 ? (
          <Num className="text-sm text-subtle">
            {t('job.queuePosition', { index: batch.index, count: batch.count })}
          </Num>
        ) : null}
        {body}
        {job && isServerActive(job.state) ? null : (
          <Button label={t('common.back')} variant="ghost" onPress={back} />
        )}
      </ScrollView>
    </Screen>
  );
}
