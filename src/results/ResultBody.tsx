import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { createElement, useEffect, useMemo } from 'react';
import type { ConversionJob } from '@/api/schemas/job';
import {
  trackResultViewed,
  type ResultContext,
  type ResultSurface,
} from '@/analytics/resultEvents';
import { formatBytes, formatDateTime } from '@/lib/format';
import { Num, Text } from '@/ui/components/Text';
import { findOriginal } from './cache';
import { ActionsBar } from './ActionsBar';
import { canOfferMp3 } from './mp3';
import { isShareable } from './shareable';
import { useResultActions } from './useResultActions';
import { useAppSelector } from '@/state/hooks';
import { describe, type ResultDescriptor, type ResultKind } from './describe';
import { viewerFor } from './viewers';
import { MetadataResultLine } from '@/metadata/ui/MetadataResultLine';
import { EditAgainButton } from '@/photo/ui/EditAgainButton';

export interface ResultSource {
  job: ConversionJob;
  /** From the registry row; absent when the screen was opened by id with no local record. */
  webTask?: string;
  resultHint?: ResultKind;
  toolSlug?: string;
  mediaKind?: ResultContext['mediaKind'];
  /** Registry tool for "Run another" and the MP3 offer; absent for a job opened by id. */
  tool?: { id: string; family: string; kind: 'image' | 'video' | 'audio' | 'pdf' };
}

/** Builds the descriptor from the server snapshot, attaching MA12's cached original when it exists. */
export function buildDescriptor(src: ResultSource): ResultDescriptor {
  const { job } = src;
  const original = findOriginal(job.id, job.originalFile.name, job.originalFile.type);
  return describe({
    job,
    task: src.webTask,
    mode: job.mode,
    kindHint: src.resultHint,
    original: original && original.kind === 'image' ? original : undefined,
  });
}

/** The completed-job body: viewer, then the info row (kind, size, "Keeps until"). MA14's actions bar goes below. */
export function ResultBody({ source, surface }: { source: ResultSource; surface: ResultSurface }) {
  const { t } = useTranslation();
  const descriptor = useMemo(() => buildDescriptor(source), [source]);
  const context = useMemo<ResultContext>(
    () => ({
      jobId: descriptor.jobId,
      toolSlug: source.toolSlug,
      mediaKind: source.mediaKind,
    }),
    [descriptor.jobId, source.toolSlug, source.mediaKind],
  );
  useEffect(() => {
    trackResultViewed(context, descriptor.kind, surface, Boolean(descriptor.original));
  }, [context, descriptor.kind, descriptor.original, surface]);

  const actions = useResultActions({
    descriptor,
    context,
    surface,
    tool: source.tool,
    originalName: source.job.originalFile.name,
    originalMime: source.job.originalFile.type,
  });
  const haptics = useAppSelector((s) => s.settings.haptics);
  const hints = [source.tool?.id, source.webTask, source.toolSlug];

  return (
    <View className="gap-4" testID="result-body">
      {createElement(viewerFor(descriptor.kind), { descriptor, context })}
      <View className="gap-1 rounded-lg border border-edge bg-surface-1 p-3" testID="result-info">
        <Text className="font-semibold">{t(`interface:resultPanel.kind.${descriptor.kind}`)}</Text>
        {descriptor.sizeBytes !== undefined ? (
          <Num className="text-sm text-muted-fg">
            {t('interface:resultPanel.size')}: {formatBytes(descriptor.sizeBytes)}
          </Num>
        ) : null}
        {descriptor.expiresAt ? (
          <Num className="text-sm text-muted-fg">
            {t('result.keepsUntil', { date: formatDateTime(descriptor.expiresAt, 'dateTime') })}
          </Num>
        ) : null}
      </View>
      <MetadataResultLine
        jobId={descriptor.jobId}
        available={descriptor.metadataAvailable}
        strippedCount={descriptor.strippedCount}
        toolSlug={source.toolSlug}
      />
      {/* MA52: from History only (right after an export the editor is still under this screen). */}
      {surface === 'history' ? (
        <EditAgainButton job={source.job} toolSlug={source.toolSlug} />
      ) : null}
      <ActionsBar
        actions={actions}
        haptics={haptics}
        canShareLink={isShareable(descriptor.kind, source.webTask, source.job.mode, ...hints)}
        canMp3={canOfferMp3(descriptor.fileName, ...hints)}
        canRunAnother={Boolean(source.tool)}
      />
    </View>
  );
}

// i18n-keys: interface:resultPanel.kind.image, interface:resultPanel.kind.gif, interface:resultPanel.kind.video, interface:resultPanel.kind.audio, interface:resultPanel.kind.transcript, interface:resultPanel.kind.captions, interface:resultPanel.kind.pdf, interface:resultPanel.kind.archive, interface:resultPanel.kind.hls, interface:resultPanel.kind.dash, interface:resultPanel.kind.metadata, interface:resultPanel.kind.summary, interface:resultPanel.kind.unknown
